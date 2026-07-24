import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import {
  fetchPoints,
  insertPoint,
  updatePoint as dbUpdatePoint,
  deletePoint as dbDeletePoint,
  addPointNote,
  subscribePoints,
} from '../data/points'
import type { MapPoint, Profile } from '../domain/types'
import type { PointStatus } from '../domain/status'

/** Résultat d'une pose de point (UI optimiste). */
export interface AddPointResult {
  /** Point affiché immédiatement (id temporaire tant que l'insert n'est pas confirmé). */
  point: MapPoint
  /** Résout avec le point définitif (id base), ou null si échec ou annulation. */
  saved: Promise<MapPoint | null>
}

/**
 * Gère la liste des points de la carte.
 * - Supabase configuré + profil chargé : lecture, écriture et temps réel en base.
 * - Sinon : "mode local" (points en mémoire, perdus au rafraîchissement).
 * La pose est OPTIMISTE : le point apparaît immédiatement (id temporaire), puis
 * est réconcilié avec l'id base — ou retiré (rollback) si l'insert échoue.
 */
type PointChanges = {
  status?: PointStatus
  note?: string | null
  client_name?: string | null
  revisit_at?: string | null
  mat_toit_confirme?: string | null
}

export function usePoints(profile: Profile | null) {
  const [points, setPoints] = useState<MapPoint[]>([])

  // id temporaire -> 'pending' (insert en cours) | 'cancelled' (annulé avant
  // confirmation) | id définitif (insert confirmé).
  const tempIdsRef = useRef(new Map<string, string>())
  // Éditions faites PENDANT que l'insert d'un point est en vol : rejouées en
  // base à la confirmation (avant : appliquées à l'écran seulement, puis
  // écrasées par la réconciliation — statut/note perdus, audit).
  const pendingEditsRef = useRef(new Map<string, { changes: PointChanges; notes: string[] }>())

  const online = supabase !== null && profile !== null

  useEffect(() => {
    if (!online) return
    let active = true
    // Les événements realtime reçus PENDANT un (re)fetch sont bufferisés et
    // rejoués après : le snapshot du fetch n'écrase plus un statut/une
    // suppression arrivés entre-temps (audit).
    let fetching = false
    let buffer: Array<
      { t: 'upsert'; p: MapPoint } | { t: 'delete'; id: string }
    > = []

    const applyInsert = (p: MapPoint) =>
      setPoints((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    const applyUpdate = (p: MapPoint) =>
      setPoints((prev) => prev.map((x) => (x.id === p.id ? p : x)))
    const applyDelete = (id: string) => setPoints((prev) => prev.filter((x) => x.id !== id))

    const refetch = async () => {
      fetching = true
      buffer = []
      try {
        const ps = await fetchPoints()
        if (!active) return
        setPoints((prev) => {
          // Fusion, pas remplacement : les points optimistes en vol survivent.
          const temp = prev.filter((x) => x.id.startsWith('temp-'))
          return [...ps, ...temp]
        })
        for (const ev of buffer) {
          if (ev.t === 'delete') applyDelete(ev.id)
          else {
            applyDelete(ev.p.id) // upsert : remplace si présent…
            applyInsert(ev.p) // …ajoute sinon
          }
        }
      } catch (e) {
        console.error('Chargement des points :', e)
      } finally {
        fetching = false
        buffer = []
      }
    }
    void refetch()

    let subscribedOnce = false
    const unsubscribe = subscribePoints(
      {
        onInsert: (p) => {
          if (fetching) buffer.push({ t: 'upsert', p })
          applyInsert(p)
        },
        onUpdate: (p) => {
          if (fetching) buffer.push({ t: 'upsert', p })
          applyUpdate(p)
        },
        onDelete: (id) => {
          if (fetching) buffer.push({ t: 'delete', id })
          applyDelete(id)
        },
      },
      (status) => {
        // Re-SUBSCRIBED après une coupure (veille iOS, zone blanche) : les
        // événements émis pendant la coupure sont définitivement perdus par
        // le canal — on resynchronise par un refetch fusionnant.
        if (status !== 'SUBSCRIBED') return
        if (!subscribedOnce) {
          subscribedOnce = true // premier abonnement : le fetch initial couvre
          return
        }
        void refetch()
      },
    )

    // Retour au premier plan de la PWA : même resynchronisation (la websocket
    // iOS meurt à chaque mise en poche, parfois sans re-SUBSCRIBED propre).
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [online])

  const addPoint = useCallback(
    (lng: number, lat: number, status: PointStatus, note?: string | null): AddPointResult => {
      const temp: MapPoint = {
        id: `temp-${crypto.randomUUID()}`,
        lng,
        lat,
        status,
        note: note ?? null,
        client_name: null,
        address: null,
        revisit_at: null,
        visited_at: new Date().toISOString(),
        annee_construction: null,
        mat_toit: null,
        mat_toit_confirme: null,
        toit_surface_m2: null,
        dpe_classe: null,
        maison_extra: null,
        enriched_at: null,
        toit_lidar_m2: null,
        toit_lidar_principal_m2: null,
        toit_lidar_statut: null,
        toit_lidar_millesime: null,
        toit_lidar_version: null,
        toit_lidar_diag: null,
        toit_lidar_pans: null,
      }
      setPoints((prev) => [...prev, temp])

      if (!online || !profile) {
        return { point: temp, saved: Promise.resolve(temp) }
      }

      tempIdsRef.current.set(temp.id, 'pending')
      const saved = insertPoint(profile, lng, lat, status, note)
        .then(async (p) => {
          if (tempIdsRef.current.get(temp.id) === 'cancelled') {
            // Annulé pendant l'enregistrement : on efface aussi en base.
            tempIdsRef.current.delete(temp.id)
            setPoints((prev) => prev.filter((x) => x.id !== p.id))
            await dbDeletePoint(p.id).catch((e) => console.error('Annulation du point :', e))
            return null
          }
          tempIdsRef.current.set(temp.id, p.id)
          // Rejoue en base les éditions faites pendant l'insert (statut
          // corrigé, note dictée…) — elles n'étaient qu'à l'écran.
          const pendingEdits = pendingEditsRef.current.get(temp.id)
          pendingEditsRef.current.delete(temp.id)
          let final = p
          if (pendingEdits) {
            try {
              if (Object.keys(pendingEdits.changes).length) {
                final = await dbUpdatePoint(profile, p.id, pendingEdits.changes)
              }
              for (const body of pendingEdits.notes) {
                await addPointNote(profile, p.id, body)
                final = { ...final, note: body }
              }
            } catch (e) {
              console.error('Rejeu des éditions du point :', e)
              toast.error('Certaines modifications n’ont pas pu être enregistrées')
            }
          }
          const settled = final
          setPoints((prev) => {
            // Remplace le point temporaire par le définitif (sans doublon si le
            // temps réel l'a déjà inséré).
            const rest = prev.filter((x) => x.id !== temp.id)
            return rest.some((x) => x.id === settled.id)
              ? rest.map((x) => (x.id === settled.id ? settled : x))
              : [...rest, settled]
          })
          return settled
        })
        .catch((e: unknown) => {
          console.error('Ajout du point :', e)
          tempIdsRef.current.delete(temp.id)
          setPoints((prev) => prev.filter((x) => x.id !== temp.id))
          toast.error('Point non enregistré — vérifiez le réseau')
          return null
        })
      return { point: temp, saved }
    },
    [online, profile],
  )

  const updatePoint = useCallback(
    async (
      id: string,
      changes: {
        status?: PointStatus
        note?: string | null
        client_name?: string | null
        revisit_at?: string | null
        mat_toit_confirme?: string | null
      },
    ) => {
      const mapped = tempIdsRef.current.get(id)
      const realId = mapped && mapped !== 'pending' && mapped !== 'cancelled' ? mapped : id
      if (online && profile && mapped === 'pending') {
        // Insert encore en vol : mémorisé pour rejeu à la confirmation
        // (l'affichage local est fait plus bas).
        const q = pendingEditsRef.current.get(id) ?? { changes: {}, notes: [] }
        q.changes = { ...q.changes, ...changes }
        pendingEditsRef.current.set(id, q)
      }
      if (online && profile && mapped !== 'pending') {
        // Les erreurs (réseau, droits RLS : seul l'auteur ou le manager peut
        // modifier) REMONTENT à l'appelant — pas de faux succès.
        const p = await dbUpdatePoint(profile, realId, changes)
        setPoints((prev) => prev.map((x) => (x.id === id || x.id === realId ? p : x)))
      } else {
        setPoints((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  ...(changes.status !== undefined ? { status: changes.status } : {}),
                  ...(changes.note !== undefined ? { note: changes.note } : {}),
                  ...(changes.client_name !== undefined ? { client_name: changes.client_name } : {}),
                  ...(changes.revisit_at !== undefined ? { revisit_at: changes.revisit_at } : {}),
                  ...(changes.mat_toit_confirme !== undefined
                    ? { mat_toit_confirme: changes.mat_toit_confirme }
                    : {}),
                }
              : x,
          ),
        )
      }
    },
    [online, profile],
  )

  // Ajoute une note au journal de la maison (les notes s'empilent, jamais
  // écrasées). Met aussi à jour la "dernière note" locale (pastille, agenda).
  const addNote = useCallback(
    async (id: string, body: string) => {
      const mapped = tempIdsRef.current.get(id)
      const realId = mapped && mapped !== 'pending' && mapped !== 'cancelled' ? mapped : id
      if (online && profile && mapped === 'pending') {
        // Insert en vol : la note sera rejouée à la confirmation.
        const q = pendingEditsRef.current.get(id) ?? { changes: {}, notes: [] }
        q.notes.push(body)
        pendingEditsRef.current.set(id, q)
      }
      if (online && profile && mapped !== 'pending') {
        await addPointNote(profile, realId, body) // les erreurs remontent
      }
      setPoints((prev) =>
        prev.map((x) => (x.id === id || x.id === realId ? { ...x, note: body } : x)),
      )
    },
    [online, profile],
  )

  const removePoint = useCallback(
    async (id: string) => {
      const mapped = tempIdsRef.current.get(id)
      if (mapped === 'pending') {
        // Insert encore en cours : on marque annulé, l'effacement en base
        // suivra dès la confirmation (voir addPoint).
        tempIdsRef.current.set(id, 'cancelled')
        setPoints((prev) => prev.filter((x) => x.id !== id))
        return
      }
      const realId = mapped && mapped !== 'cancelled' ? mapped : id
      if (online) {
        // L'échec (réseau, RLS : point d'un collègue) REMONTE et le point
        // reste affiché — avant : retiré localement + « supprimé » affiché,
        // puis réapparition au prochain chargement (audit).
        await dbDeletePoint(realId)
      }
      if (mapped) tempIdsRef.current.delete(id)
      setPoints((prev) => prev.filter((x) => x.id !== id && x.id !== realId))
    },
    [online],
  )

  return { points, addPoint, updatePoint, addNote, removePoint }
}
