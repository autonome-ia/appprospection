import { useCallback, useEffect, useState } from 'react'
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

/**
 * Gère la liste des points de la carte.
 * - Supabase configuré + profil chargé : lecture, écriture et temps réel en base.
 * - Sinon : "mode local" (points en mémoire, perdus au rafraîchissement).
 */
export function usePoints(profile: Profile | null) {
  const [points, setPoints] = useState<MapPoint[]>([])

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
    async (lng: number, lat: number, status: PointStatus): Promise<MapPoint | null> => {
      if (online && profile) {
        try {
          const p = await insertPoint(profile, lng, lat, status)
          setPoints((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
          return p
        } catch (e) {
          console.error('Ajout du point :', e)
          return null
        }
      }
      const local: MapPoint = { id: crypto.randomUUID(), lng, lat, status }
      setPoints((prev) => [...prev, local])
      return local
    },
    [online, profile],
  )

  const updatePoint = useCallback(
    async (id: string, changes: { status?: PointStatus; note?: string | null }) => {
      if (online && profile) {
        try {
          const p = await dbUpdatePoint(profile, id, changes)
          setPoints((prev) => prev.map((x) => (x.id === id ? p : x)))
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
      if (online) {
        try {
          await dbDeletePoint(id)
        } catch (e) {
          console.error('Suppression du point :', e)
        }
      }
      setPoints((prev) => prev.filter((x) => x.id !== id))
    },
    [online],
  )

  return { points, addPoint, updatePoint, removePoint }
}
