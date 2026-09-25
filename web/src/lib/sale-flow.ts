// Formulaire de vente (chantier Numbers) : ouvert de n'importe où par un
// événement, rendu une seule fois par <SaleFlowHost /> (App.tsx) — même
// modèle que celebrate(). Les 4 « Vendu » de la prospection (agenda, fiche
// point, popup du matin, bascule manuelle) n'ajoutent qu'une ligne.
export const SALE_FLOW_EVENT = 'app:sale-flow'

export type SaleFlowRequest =
  /** Juste après un « Vendu » : la vente « à compléter » est créée en base
      AVANT l'ouverture (fermer la sheet ne perd rien, D11). */
  | { kind: 'vendu'; pointId: string; appointmentId?: string | null }
  /** Ouvrir une vente existante (cahier, « à compléter »). */
  | { kind: 'open'; saleId: string }
  /** « + Vente » : saisie libre (lead entrant, ancien client…). */
  | { kind: 'new' }

export function openSaleFlow(req: SaleFlowRequest) {
  window.dispatchEvent(new CustomEvent<SaleFlowRequest>(SALE_FLOW_EVENT, { detail: req }))
}
