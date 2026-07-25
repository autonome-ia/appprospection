import type { PointStatus } from './status'
import type { HouseExtra, LidarDiag, RoofData } from './house'

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
  /** Auteur de la pose — la carte du commercial ne montre que SES points
      (décision chef des ventes, 25/07) ; null pour un point optimiste local. */
  created_by: string | null
  /** Note terrain (contexte de la maison) — aussi source de la pastille "a une note". */
  note: string | null
  /** Nom du client / occupant (mini-CRM). */
  client_name: string | null
  /** Téléphone du client — « rappelez-moi, voilà mon 06 » d'un « à revoir »
      (db/0014) ; synchronisé avec le RDV comme client_name. */
  client_phone: string | null
  /** Adresse (renseignée automatiquement par géocodage inverse BAN à la pose). */
  address: string | null
  /** Date de relance (YYYY-MM-DD) pour les points « à revoir ». */
  revisit_at: string | null
  /** Dernière VISITE commerciale (pose ou changement de statut — pas les
      écritures techniques). Filtre « ancienneté » de la carte (db/0012). */
  visited_at: string | null
  /** Fiche maison enrichie (open data BD TOPO / BDNB, cache à la pose). */
  annee_construction: number | null
  mat_toit: string | null
  /** Matériau constaté sur le terrain (prioritaire sur la donnée fiscale). */
  mat_toit_confirme: string | null
  toit_surface_m2: number | null
  dpe_classe: string | null
  /** Attributs BD TOPO complémentaires (usage, étages, murs… — db/0010). */
  maison_extra: HouseExtra | null
  enriched_at: string | null
  /** Surface de toiture MESURÉE (nuage de points LiDAR HD IGN, cache définitif). */
  toit_lidar_m2: number | null
  toit_lidar_principal_m2: number | null
  /** ok | faible_confiance | grand_batiment | no_data | error (voir data/lidar.ts). */
  toit_lidar_statut: string | null
  toit_lidar_millesime: string | null
  toit_lidar_version: number | null
  /** Diagnostic de la mesure (motif d'un no_data, végétation… — db/0011). */
  toit_lidar_diag: LidarDiag | null
  /** Toit mesuré (murs + pans jointifs) — absent du SELECT global (poids),
      présent sur les lignes du temps réel et via fetchPointPans. */
  toit_lidar_pans: RoofData | null
}
