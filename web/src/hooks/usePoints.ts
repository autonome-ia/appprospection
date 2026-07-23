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
export function usePoints(profile: Profile | null) {
  const [points, setPoints] = useState<MapPoint[]>([])

  // id temporaire -> 'pending' (insert en cours) | 'cancelled' (annulé avant
  // confirmation) | id définitif (insert confirmé).
  const tempIdsRef = useRef(new Map<string, string>())

  const online = supabase !== null && profile !== null

  useEffect(() => {
    if (!online) return
    let active = true

    fetchPoints()
      .then((ps) => {
        if (active) setPoints(ps)
      })
      .catch((e) => console.error('Chargement des points :', e))

    const unsubscribe = subscribePoints({
      onInsert: (p) => setPoints((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p])),
      onUpdate: (p) => setPoints((prev) => prev.map((x) => (x.id === p.id ? p : x))),
      onDelete: (id) => setPoints((prev) => prev.filter((x) => x.id !== id)),
    })

    return () => {
      active = false
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
        annee_construction: null,
        mat_toit: null,
        mat_toit_confirme: null,
        toit_surface_m2: null,
        dpe_classe: null,
        enriched_at: null,
        toit_lidar_m2: null,
        toit_lidar_principal_m2: null,
        toit_lidar_statut: null,
        toit_lidar_millesime: null,
        toit_lidar_version: null,
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
          setPoints((prev) => {
            // Remplace le point temporaire par le définitif (sans doublon si le
            // temps réel l'a déjà inséré).
            const rest = prev.filter((x) => x.id !== temp.id)
            return rest.some((x) => x.id === p.id) ? rest : [...rest, p]
          })
          return p
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
      if (mapped) tempIdsRef.current.delete(id)
      if (online) {
        try {
          await dbDeletePoint(realId)
        } catch (e) {
          console.error('Suppression du point :', e)
        }
      }
      setPoints((prev) => prev.filter((x) => x.id !== id && x.id !== realId))
    },
    [online],
  )

  return { points, addPoint, updatePoint, addNote, removePoint }
}
