// Bulles de regroupement : badge plein (accent, chiffre Geist Mono) rendu en
// marqueur DOM — permet la vraie police de la DA et un style CSS (tokens),
// ce que les couches symbol de MapLibre ne offrent pas. Il n'y a que
// quelques clusters visibles à la fois : des éléments DOM suffisent.

/** Propriétés d'un cluster (fournies par MapLibre). */
export type ClusterProps = Record<string, unknown> & {
  cluster_id: number
  point_count: number
  point_count_abbreviated: string | number
}

/** Construit l'élément DOM du badge (taille selon le nombre de points). */
export function createClusterBadge(props: ClusterProps): HTMLElement {
  const total = Number(props.point_count) || 0
  const el = document.createElement('div')
  el.className = `cluster-badge${total >= 50 ? ' is-lg' : total >= 10 ? ' is-md' : ''}`
  el.textContent = String(props.point_count_abbreviated)
  return el
}
