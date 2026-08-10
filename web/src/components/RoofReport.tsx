import { useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { FileText, Printer, Share2, X } from 'lucide-react'
import type { RoofData } from '../domain/house'
import { RoofDiagramSvg, panLetters } from './RoofDiagram'
import { useSession } from '../lib/session'

// -----------------------------------------------------------------------------
// Rapport client : le document propre remis (ou montré) au prospect à la fin
// de la visite — là où les concurrents (EagleView, Roofr) livrent en heures
// ou en jours, nous le générons sur le pas de la porte. Plan coté, tableau
// des pans, longueurs par type d'arête, tableau de chutes multi-pourcentages
// (présentation EagleView), provenance « laser IGN ». Impression via le PDF
// natif du téléphone (window.print), partage via l'API Web Share.
// -----------------------------------------------------------------------------

interface Props {
  roof: RoofData
  address: string | null
  /** Surface « la maison » (badge) et total mesuré. */
  maisonM2: number | null
  totalM2: number | null
  millesime: string | null
  /** % de chutes suggéré (mis en avant dans le tableau). */
  wastePct: number
  /** Pans exclus de la sélection Σ (audit UX B3) : le rapport reflète ce
      qu'on vient de cocher AVEC le client — surface retenue, chutes sur la
      sélection, pans exclus grisés. */
  excluded?: ReadonlySet<number>
  /** Piloté par le module « Toiture mesurée » : ouvre l'overlay directement
      (pas de bouton déclencheur) et rend la fermeture au parent. */
  embedded?: boolean
  onClose?: () => void
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
const exposition = (az: number) => CARDINALS[Math.round(az / 45) % 8]

const EDGE_LABELS: [keyof NonNullable<RoofData['aretes']>, string][] = [
  ['faitage_m', 'Faîtage'],
  ['aretier_m', 'Arêtiers'],
  ['noue_m', 'Noues'],
  ['rive_m', 'Rives'],
  ['egout_m', 'Égouts (gouttières)'],
  ['solin_m', 'Solins'],
]

export function RoofReport({
  roof,
  address,
  maisonM2,
  totalM2,
  millesime,
  wastePct,
  excluded,
  embedded = false,
  onClose,
}: Props) {
  const [open, setOpen] = useState(embedded)
  // Génération du document en cours (canvas + partage) : anti-double-tap.
  const [sharing, setSharing] = useState(false)
  const { profile } = useSession()
  const letters = panLetters(roof)
  if (letters.size === 0) return null

  // Identité (audit UX A23) : un rapport anonyme face aux références
  // brandées (Roofr, EagleView) — « Établi le … par … ».
  const identLine = `Établi le ${new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())}${profile?.full_name ? ` par ${profile.full_name}` : ''}`

  if (!open && !embedded) {
    return (
      <button type="button" className="roof3d-btn" onClick={() => setOpen(true)}>
        <FileText size={15} strokeWidth={1.9} />
        Rapport client
      </button>
    )
  }

  // Surface RETENUE avec le client (Σ des pans cochés en 3D) : c'est elle
  // qui pilote la surface de commande — le rapport ne contredit plus la
  // sélection faite une minute plus tôt (audit UX B3).
  const selectionM2 = excluded
    ? Math.round(roof.pans.reduce((s, p, i) => (excluded.has(i) ? s : s + p.m2), 0))
    : null
  // Affichée seulement si elle diffère du badge « maison » (sinon doublon).
  const showSelection =
    selectionM2 !== null && selectionM2 > 0 && (maisonM2 === null || Math.abs(selectionM2 - maisonM2) >= 1)
  const base = selectionM2 !== null && selectionM2 > 0 ? selectionM2 : (maisonM2 ?? totalM2 ?? 0)
  const wasteRows = [...new Set([0, 10, wastePct, 20])].sort((a, b) => a - b)
  const survol = millesime ? millesime.slice(0, 4) : null
  // PWA iOS INSTALLÉE : window.print() est un no-op (pas de moteur
  // d'impression en mode standalone) — le bouton est masqué, Partager reste.
  const canPrint = !(
    'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true
  )

  // Message d'accompagnement du document (et repli si le partage de
  // fichiers n'est pas disponible).
  const shareText = () =>
    [
      `Rapport de toiture${address ? ` - ${address}` : ''}`,
      maisonM2 != null ? `Toit de la maison : ${maisonM2} m² (mesure laser IGN LiDAR HD)` : null,
      totalM2 != null && totalM2 !== maisonM2 ? `Total avec annexes : ${totalM2} m²` : null,
      showSelection ? `Surface retenue ensemble : ${selectionM2} m²` : null,
      `Surface de commande conseillée (+${wastePct} % de chutes) : ${Math.round(base * (1 + wastePct / 100))} m²`,
      survol ? `Survol laser IGN ${survol} · précision ±5 %` : null,
      identLine,
    ]
      .filter(Boolean)
      .join('\n')

  // Partage en DOCUMENT (audit UX C2) : le rapport est rendu en image côté
  // client (canvas, chunk à la demande) et part en fichier via l'API Web
  // Share — en PWA iOS installée, window.print() est un no-op et le texte
  // seul ne faisait pas « document remis au prospect ».
  const shareDocument = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const { renderReportImage } = await import('../lib/report-image')
      const blob = await renderReportImage({
        roof,
        excluded,
        letters: [...letters.entries()].sort((a, b) => a[1].localeCompare(b[1])),
        address,
        maisonM2,
        totalM2,
        selectionM2,
        showSelection,
        base,
        wastePct,
        wasteRows,
        edgeRows: roof.aretes
          ? EDGE_LABELS.filter(([k]) => (roof.aretes![k] ?? 0) >= 1).map(([k, label]) => [
              label,
              `${String(roof.aretes![k]).replace('.', ',')} m`,
            ])
          : [],
        survol,
        identLine,
      })
      const slug = (address ?? 'maison')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // diacritiques décomposés (é → e + ́)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
      const file = new File([blob], `rapport-toiture-${slug}.png`, { type: 'image/png' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText() })
      } else if (navigator.share) {
        // Fichiers non partageables (vieux navigateur) : au moins le texte.
        await navigator.share({ title: 'Rapport de toiture', text: shareText() })
      } else {
        // Desktop sans Web Share : téléchargement direct.
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      // Partage annulé par l'utilisateur = pas une erreur.
      if ((e as Error).name !== 'AbortError') {
        console.error('Partage du rapport :', e)
        toast.error('Partage impossible : réessayez')
      }
    } finally {
      setSharing(false)
    }
  }

  return createPortal(
    <div className="roof-report-overlay">
      <div className="roof-report">
        <div className="roof-report-actions">
          {canPrint && (
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <Printer size={15} /> Imprimer / PDF
            </button>
          )}
          <button type="button" className="btn" onClick={() => void shareDocument()} disabled={sharing}>
            <Share2 size={15} /> {sharing ? 'Préparation…' : 'Partager'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => (embedded ? onClose?.() : setOpen(false))}
            aria-label="Fermer le rapport"
          >
            <X size={16} />
          </button>
        </div>

        <header className="roof-report-head">
          <h2>Rapport de toiture</h2>
          {address && <p className="roof-report-address">{address}</p>}
          <p className="roof-report-source">
            Mesure au laser aéroporté · nuage de points IGN LiDAR HD
            {survol ? ` · survol ${survol}` : ''} · précision ±5 %
          </p>
          <p className="roof-report-ident">{identLine}</p>
        </header>

        <div className="roof-report-totals tnum">
          {maisonM2 != null && (
            <div>
              <span className="roof-report-figure">{maisonM2} m²</span>
              <span className="roof-report-caption">toit de la maison</span>
            </div>
          )}
          {totalM2 != null && totalM2 !== maisonM2 && (
            <div>
              <span className="roof-report-figure">{totalM2} m²</span>
              <span className="roof-report-caption">avec annexes et extensions</span>
            </div>
          )}
          {showSelection && (
            <div className="roof-report-selection">
              <span className="roof-report-figure">Σ {selectionM2} m²</span>
              <span className="roof-report-caption">surface retenue avec vous</span>
            </div>
          )}
        </div>

        <RoofDiagramSvg roof={roof} excluded={excluded} />

        <table className="roof-report-table tnum">
          <thead>
            <tr>
              <th>Pan</th>
              <th>Surface</th>
              <th>Pente</th>
              <th>Exposition</th>
            </tr>
          </thead>
          <tbody>
            {[...letters.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([idx, letter]) => {
                const pan = roof.pans[idx]
                const off = excluded?.has(idx) ?? false
                return (
                  <tr key={idx} className={off ? 'is-excluded' : ''}>
                    <td>{letter}{off ? ' · exclu' : ''}</td>
                    <td>{pan.m2} m²</td>
                    <td>{pan.pente_deg}°</td>
                    <td>{pan.type === 'plat' ? '-' : exposition(pan.azimut_deg)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>

        {roof.aretes && (
          <table className="roof-report-table tnum">
            <thead>
              <tr>
                <th>Longueurs</th>
                <th>mesure laser</th>
              </tr>
            </thead>
            <tbody>
              {EDGE_LABELS.filter(([k]) => (roof.aretes![k] ?? 0) >= 1).map(([k, label]) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td>{String(roof.aretes![k]).replace('.', ',')} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {base > 0 && (
          <table className="roof-report-table tnum">
            <thead>
              <tr>
                <th>{showSelection ? 'Chutes (sur Σ retenue)' : 'Chutes de coupe'}</th>
                {wasteRows.map((w) => (
                  <th key={w} className={w === wastePct ? 'is-suggested' : ''}>
                    {w} %
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Surface de commande</td>
                {wasteRows.map((w) => (
                  <td key={w} className={w === wastePct ? 'is-suggested' : ''}>
                    {Math.round(base * (1 + w / 100))} m²
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}

        <p className="data-attribution">
          Données IGN (BD TOPO, LiDAR HD) · surface « maison » hors annexes · chutes indicatives
          selon matériau et complexité
        </p>
      </div>
    </div>,
    document.body,
  )
}
