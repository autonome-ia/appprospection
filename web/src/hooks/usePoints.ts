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
  // Posé par l'effet realtime : enregistre le rejeu d'une mutation LOCALE
  // (statut modifié, note, suppression, réconciliation d'insert) si un
  // refetch est en vol — sinon son snapshot, requêté AVANT la mutation,
  // l'écraserait en s'appliquant après (contre-audit, bug 2).
  const bufferLocalRef = useRef<(replay: () => void) => void>(() => {})

  const online = supabase !== null && profile !== null

  useEffect(() => {
    if (!online) return
    let active = true
    // Les événements realtime ET les mutations locales survenus PENDANT un
    // (re)fetch sont bufferisés (fonctions de rejeu) et rejoués après le
    // snapshot : celui-ci n'écrase plus un statut/une suppression arrivés
    // entre-temps (audit).
    // `gen` : deux refetchs peuvent se croiser (visibilitychange PUIS
    // re-SUBSCRIBED au réveil iOS) — seul le PLUS RÉCENT applique son
    // snapshot, sinon le plus périmé gagnait s'il résolvait en dernier
    // (contre-audit, bug 1).
    let gen = 0
    let inFlight = 0
    let buffer: Array<() => void> = []

    bufferLocalRef.current = (replay) => {
      if (inFlight > 0) buffer.push(replay)
    }

    const applyInsert = (p: MapPoint) =>
      setPoints((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    const applyUpdate = (p: MapPoint) =>
      setPoints((prev) => prev.map((x) => (x.id === p.id ? p : x)))
    const applyDelete = (id: string) => setPoints((prev) => prev.filter((x) => x.id !== id))
    const applyUpsert = (p: MapPoint) => {
      applyDelete(p.id) // remplace si présent…
      applyInsert(p) // …ajoute sinon
    }

    const refetch = async () => {
      const my = ++gen
      inFlight++
      try {
        const ps = await fetchPoints()
        // Un refetch plus récent est parti depuis : son snapshot fera foi,
        // appliquer le nôtre (plus vieux) reculerait l'état.
        if (!active || my !== gen) return
        setPoints((prev) => {
          // Fusion, pas remplacement : les points optimistes en vol survivent.
          const temp = prev.filter((x) => x.id.startsWith('temp-'))
          return [...ps, ...temp]
        })
        for (const replay of buffer) replay()
        buffer = []
      } catch (e) {
        console.error('Chargement des points :', e)
      } finally {
        inFlight--
        if (inFlight === 0) buffer = []
      }
    }
    void refetch()

    let subscribedOnce = false
    const unsubscribe = subscribePoints(
      {
        onInsert: (p) => {
          if (inFlight > 0) buffer.push(() => applyUpsert(p))
          applyInsert(p)
        },
        onUpdate: (p) => {
          if (inFlight > 0) buffer.push(() => applyUpsert(p))
          applyUpdate(p)
        },
        onDelete: (id) => {
          if (inFlight > 0) buffer.push(() => applyDelete(id))
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
      bufferLocalRef.current = () => {}
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
            const applyCancel = (prev: MapPoint[]) => prev.filter((x) => x.id !== p.id)
            bufferLocalRef.current(() => setPoints(applyCancel))
            setPoints(applyCancel)
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
          const applySettled = (prev: MapPoint[]) => {
            // Remplace le point temporaire par le définitif (sans doublon si le
            // temps réel l'a déjà inséré).
            const rest = prev.filter((x) => x.id !== temp.id)
            return rest.some((x) => x.id === settled.id)
              ? rest.map((x) => (x.id === settled.id ? settled : x))
              : [...rest, settled]
          }
          // Rejoué si un refetch est en vol : son snapshot ne connaît pas
          // encore l'id réel et ne conserve que les points temp-.
          bufferLocalRef.current(() => setPoints(applySettled))
          setPoints(applySettled)
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
        const apply = (prev: MapPoint[]) =>
          prev.map((x) => (x.id === id || x.id === realId ? p : x))
        bufferLocalRef.current(() => setPoints(apply))
        setPoints(apply)
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
      const apply = (prev: MapPoint[]) =>
        prev.map((x) => (x.id === id || x.id === realId ? { ...x, note: body } : x))
      bufferLocalRef.current(() => setPoints(apply))
      setPoints(apply)
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
      const apply = (prev: MapPoint[]) =>
        prev.filter((x) => x.id !== id && x.id !== realId)
      bufferLocalRef.current(() => setPoints(apply))
      setPoints(apply)
    },
    [online],
  )

  return { points, addPoint, updatePoint, addNote, removePoint }
}
