import type { PointStatus } from './status'

/** Profil applicatif (table `profiles`). */
export interface Profile {
  id: string
  organization_id: string
  full_name: string | null
  role: 'commercial' | 'manager'
}

/** Point affiché sur la carte (projection légère de la table `points`). */
export interface MapPoint {
  id: string
  lng: number
  lat: number
  status: PointStatus
}
