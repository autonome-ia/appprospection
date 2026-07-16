import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import {
  fetchPoints,
  insertPoint,
  updatePoint as dbUpdatePoint,
  deletePoint as dbDeletePoint,
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
    (lng: number, lat: number, status: PointStatus): AddPointResult => {
      const temp: MapPoint = { id: `temp-${crypto.randomUUID()}`, lng, lat, status }
      setPoints((prev) => [...prev, temp])

      if (!online || !profile) {
        return { point: temp, saved: Promise.resolve(temp) }
      }

      tempIdsRef.current.set(temp.id, 'pending')
      const saved = insertPoint(profile, lng, lat, status)
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
    async (id: string, changes: { status?: PointStatus; note?: string | null }) => {
      const mapped = tempIdsRef.current.get(id)
      const realId = mapped && mapped !== 'pending' && mapped !== 'cancelled' ? mapped : id
      if (online && profile && mapped !== 'pending') {
        try {
          const p = await dbUpdatePoint(profile, realId, changes)
          setPoints((prev) => prev.map((x) => (x.id === id || x.id === realId ? p : x)))
        } catch (e) {
          console.error('Modification du point :', e)
        }
      } else if (changes.status !== undefined) {
        setPoints((prev) => prev.map((x) => (x.id === id ? { ...x, status: changes.status! } : x)))
      }
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

  return { points, addPoint, updatePoint, removePoint }
}
