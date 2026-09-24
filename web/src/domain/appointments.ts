export type AppointmentStatus = 'a_venir' | 'effectue' | 'vendu' | 'manque' | 'annule' | 'refus'

/** Nature de l'entrée d'agenda (db/0016) : RDV de prospection, ou TÂCHE
    libre (« aller chercher l'acompte ») — datée, sans point sur la carte,
    sans issues, exclue des stats. Sa note est son titre. */
export type AppointmentKind = 'rdv' | 'tache'

export interface Appointment {
  id: string
  point_id: string | null
  commercial_id: string | null
  /** Qui a saisi le RDV — ≠ titulaire quand la secrétaire (ou un
      superviseur) l'a pris au nom du commercial : l'agenda dit « pris par ». */
  created_by: string | null
  scheduled_at: string
  address: string | null
  client_name: string | null
  client_phone: string | null
  status: AppointmentStatus
  notes: string | null
  kind: AppointmentKind
  /** Point lié (jointure PostgREST) : contexte terrain + accès carte. */
  point: { id: string; lng: number; lat: number; notes: string | null } | null
}

export interface AppointmentStatusMeta {
  value: AppointmentStatus
  label: string
  color: string
  /** Même couleur en TOKEN CSS (suit le thème : « Refus » est éclairci en
      sombre). À utiliser pour tout texte/bordure d'interface ; `color` (hex)
      reste pour les pastilles et le canvas. Audit design 24/09. */
  css: string
}

/** Texte + bordure d'un bouton d'issue, dans les deux thèmes. */
export const outcomeButtonStyle = (m: AppointmentStatusMeta) => ({
  color: m.css,
  borderColor: `color-mix(in srgb, ${m.css} 35%, transparent)`,
})

/** Libellé d'un BOUTON d'issue : « Annulé », relégué en lien sous les trois
    vraies issues, dit ce qu'il signifie (audit design 24/09). Le libellé
    court reste celui des badges et de l'historique. */
export const outcomeButtonLabel = (s: AppointmentStatus) =>
  s === 'annule' ? 'Le RDV n’a pas eu lieu' : APPOINTMENT_STATUS_META[s].label

/** Badge d'issue : texte coloré sur un voile de la même couleur. */
export const outcomeBadgeStyle = (m: AppointmentStatusMeta) => ({
  color: m.css,
  background: `color-mix(in srgb, ${m.css} 10%, transparent)`,
})

// Refonte des issues (29/07 soir, briac) : chaque issue = une réalité
// terrain + une CONSÉQUENCE sur le point (voir setAppointmentOutcome) —
// « Vendu » → Client, « En attente » (ex-Effectué : le prospect réfléchit)
// → À revoir + relance J+7, « Refus » (db/0017) → Refus, « Annulé » (RDV
// pas eu lieu) → Replanifier. « Manqué » retiré des boutons (client absent
// = annulé, on replanifie) — la valeur reste pour l'historique.
export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, AppointmentStatusMeta> = {
  a_venir: { value: 'a_venir', label: 'À venir', color: '#2f6bff', css: 'var(--st-rdv)' },
  effectue: { value: 'effectue', label: 'En attente', color: '#d97706', css: 'var(--st-revoir)' },
  vendu: { value: 'vendu', label: 'Vendu', color: '#17b26a', css: 'var(--st-vendu)' },
  manque: { value: 'manque', label: 'Manqué', color: '#e5484d', css: 'var(--danger)' },
  annule: { value: 'annule', label: 'Annulé', color: '#98a2b3', css: 'var(--ink-3)' },
  refus: { value: 'refus', label: 'Refus', color: '#344054', css: 'var(--st-impossible)' },
}

/** Issues qu'un commercial peut donner à un RDV planifié. */
export const APPOINTMENT_OUTCOMES: AppointmentStatus[] = ['vendu', 'effectue', 'refus', 'annule']

/** « En attente » est un état OUVERT (29/07 soir) : la réponse du prospect
    se donne plus tard, sur le MÊME RDV — vente différée comptée. */
export const FOLLOW_UP_OUTCOMES: AppointmentStatus[] = ['vendu', 'refus']

/** Confirmation d'une issue : dire la CONSÉQUENCE, pas répéter le bouton. */
export function outcomeToastMessage(outcome: AppointmentStatus): string {
  switch (outcome) {
    case 'vendu':
      return 'Vendu : la maison passe en « Client »'
    case 'effectue':
      return 'En attente : relance dans 7 jours, le point reste « RDV pris »'
    case 'refus':
      return 'La maison passe en « Refus »'
    case 'annule':
      return 'RDV annulé : replanifiez quand vous voulez'
    default:
      return `RDV marqué « ${APPOINTMENT_STATUS_META[outcome].label} »`
  }
}
