import type { PointStatus } from './status'
import type { LidarPan } from './house'

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
  /** Note terrain (contexte de la maison) — aussi source de la pastille "a une note". */
  note: string | null
  /** Nom du client / occupant (mini-CRM). */
  client_name: string | null
  /** Adresse (renseignée automatiquement par géocodage inverse BAN à la pose). */
  address: string | null
  /** Date de relance (YYYY-MM-DD) pour les points « à revoir ». */
  revisit_at: string | null
  /** Fiche maison enrichie (open data BD TOPO / BDNB, cache à la pose). */
  annee_construction: number | null
  mat_toit: string | null
  /** Matériau constaté sur le terrain (prioritaire sur la donnée fiscale). */
  mat_toit_confirme: string | null
  toit_surface_m2: number | null
  dpe_classe: string | null
  enriched_at: string | null
  /** Surface de toiture MESURÉE (nuage de points LiDAR HD IGN, cache définitif). */
  toit_lidar_m2: number | null
  toit_lidar_principal_m2: number | null
  /** ok | faible_confiance | grand_batiment | no_data | error (voir data/lidar.ts). */
  toit_lidar_statut: string | null
  toit_lidar_millesime: string | null
  toit_lidar_version: number | null
  /** Pans mesurés (pente, m², contour pour le dessin sur l'ortho). */
  toit_lidar_pans: LidarPan[] | null
}
