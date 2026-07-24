import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { X, Trash2, Clock, User, MapPin } from 'lucide-react'
import {
  getPointDetail,
  fetchPointNotes,
  fetchPointPans,
  type PointDetail,
  type PointNote,
} from '../data/points'
import {
  CONFIRMED_MAT_OPTIONS,
  lidarNeedsMeasure,
  suggestedWastePct,
  type HouseEnrichment,
  type RoofData,
} from '../domain/house'
import type { LidarResult } from '../data/lidar'
import { HouseBadges } from './HouseBadges'
import { Roof3D } from './Roof3D'
import { RoofDiagram } from './RoofDiagram'
import { RoofReport } from './RoofReport'
import { isSupabaseConfigured } from '../lib/supabase'
import { STATUSES, STATUS_BY_VALUE, type PointStatus } from '../domain/status'
import type { MapPoint } from '../domain/types'

interface Props {
  open: boolean
  point: MapPoint | null
  onOpenChange: (open: boolean) => void
  onUpdate: (
    id: string,
    changes: {
      status?: PointStatus
      note?: string | null
      client_name?: string | null
      revisit_at?: string | null
      mat_toit_confirme?: string | null
    },
  ) => Promise<void>
  /** Ajoute une note au journal de la maison (jamais d'écrasement). */
  onAddNote: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRdvNeeded?: (point: MapPoint) => void
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function PointDetailSheet({
  open,
  point,
  onOpenChange,
  onUpdate,
  onAddNote,
  onDelete,
  onRdvNeeded,
}: Props) {
  const [detail, setDetail] = useState<PointDetail | null>(null)
  const [status, setStatus] = useState<PointStatus>('absent')
  const [history, setHistory] = useState<PointNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [clientName, setClientName] = useState('')
  const [revisitAt, setRevisitAt] = useState('')
  const [matConfirme, setMatConfirme] = useState('')
  const [saving, setSaving] = useState(false)
  // Fiche maison récupérée à la volée (backfill des points posés avant le
  // chantier, ou point d'un autre commercial dont le cache RLS a échoué).
  const [liveEnrich, setLiveEnrich] = useState<HouseEnrichment | null>(null)
  // Mesure LiDAR calculée à la volée (backfill des points anciens, ou re-mesure
  // après montée de version de l'algo). Pendant le calcul, l'estimation n'est
  // PAS affichée (badge « mesure… » à la place — pas de flash, retour briac).
  const [liveLidar, setLiveLidar] = useState<LidarResult | null>(null)
  const [lidarPending, setLidarPending] = useState(false)
  // Pans du toit (contours + altitudes) : hors du SELECT global des points,
  // récupérés à la demande pour la maquette 3D (cache côté data/points).
  const [cachedPans, setCachedPans] = useState<RoofData | null>(null)

  // Instantané des valeurs INITIALES du formulaire : la sauvegarde n'envoie
  // que ce que l'utilisateur a touché DANS CETTE SESSION — comparer à `point`
  // (mis à jour par le realtime) réécrivait l'ancien statut par-dessus le
  // changement d'un collègue, et journalisait un faux événement (audit).
  const initialRef = useRef({ status: 'absent' as PointStatus, clientName: '', revisitAt: '', matConfirme: '' })

  useEffect(() => {
    if (!open || !point) return
    initialRef.current = {
      status: point.status,
      clientName: point.client_name ?? '',
      revisitAt: point.revisit_at ?? '',
      matConfirme: point.mat_toit_confirme ?? '',
    }
    setStatus(point.status)
    setClientName(point.client_name ?? '')
    setRevisitAt(point.revisit_at ?? '')
    setMatConfirme(point.mat_toit_confirme ?? '')
    setNewNote('')
    setDetail(null)
    setHistory([])
    setLiveEnrich(null)
    setLiveLidar(null)
    setLidarPending(false)
    setCachedPans(null)
    // Point en cours d'enregistrement (id temporaire, pose optimiste) : pas
    // encore de détail ni de journal en base.
    if (!isSupabaseConfigured || point.id.startsWith('temp-')) return
    let active = true
    // Backfill paresseux : point jamais enrichi (posé avant le chantier), ou
    // enrichi avant l'arrivée des attributs BD TOPO complémentaires
    // (maison_extra, db/0010) — seulement si un bâtiment avait été trouvé
    // (mat/surface cachés), pour ne pas re-interroger à chaque ouverture les
    // points sans bâtiment (quota BDNB).
    if (
      !point.enriched_at ||
      (point.maison_extra == null &&
        (point.mat_toit != null || point.toit_surface_m2 != null))
    ) {
      void import('../data/enrich')
        .then((m) => m.enrichPoint(point.id, point.lng, point.lat))
        .then((e) => {
          if (active) setLiveEnrich(e)
        })
        .catch((e) => console.error('Enrichissement :', e))
    }
    // Mesure LiDAR : backfill paresseux (points anciens, erreurs à re-tenter,
    // montée de version de l'algo). Chunk séparé, chargé à la demande.
    // Pour un point qui vient d'être posé, le calcul est déjà en vol
    // (data/points.ts) : le cache par coordonnées fait qu'on s'y greffe.
    if (lidarNeedsMeasure(point)) {
      setLidarPending(true)
      void import('../data/lidar')
        .then((m) => m.measurePointRoof(point.id, point.lng, point.lat))
        .then((r) => {
          // Une re-mesure en ERREUR (réseau) ne masque pas une mesure valide
          // déjà en cache : la fiche garde le badge « ok » (audit).
          if (active) {
            setLiveLidar(
              r.toit_lidar_statut === 'error' && point.toit_lidar_statut === 'ok' ? null : r,
            )
          }
        })
        .catch((e) => console.error('Mesure LiDAR :', e))
        .finally(() => {
          if (active) setLidarPending(false)
        })
    }
    // Pans pour la maquette 3D (seulement si une mesure fiable est en cache —
    // le cas re-mesure est couvert par liveLidar, qui prime à l'affichage).
    if (point.toit_lidar_statut === 'ok') {
      fetchPointPans(point.id)
        .then((ps) => {
          if (active) setCachedPans(ps)
        })
        .catch((e) => console.error('Pans du point :', e))
    }
    getPointDetail(point.id)
      .then((d) => {
        if (active && d) setDetail(d)
      })
      .catch((e) => console.error('Détail du point :', e))
    fetchPointNotes(point.id)
      .then((ns) => {
        if (active) setHistory(ns)
      })
      .catch((e) => console.error('Journal de notes :', e))
    return () => {
      active = false
    }
    // Dépend de l'ID et de l'OUVERTURE (pas de l'objet) : les mises à jour
    // temps réel ne réinitialisent pas la saisie, mais ROUVRIR la même fiche
    // repart bien d'un formulaire propre (une note restée dans le champ
    // pouvait être enregistrée en double — audit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.id, open])

  if (!point) return null

  const init = initialRef.current
  const dirty =
    status !== init.status ||
    clientName !== init.clientName ||
    matConfirme !== init.matConfirme ||
    (status === 'a_revoir' && revisitAt !== init.revisitAt) ||
    newNote.trim().length > 0

  // Journal affiché : le vrai journal, ou à défaut la dernière note connue
  // du point (ancienne donnée pas encore migrée, ou fetch en cours).
  const shownNotes: PointNote[] =
    history.length === 0 && point.note
      ? [
          {
            id: 'legacy',
            body: point.note,
            created_at: detail?.created_at ?? '',
            author_name: detail?.author_name ?? null,
          },
        ]
      : history

  async function save() {
    if (!point) return
    setSaving(true)
    const changes: {
      status?: PointStatus
      client_name?: string | null
      revisit_at?: string | null
      mat_toit_confirme?: string | null
    } = {}
    // Diff contre l'instantané INITIAL (pas contre `point`, mis à jour par le
    // realtime) : seuls les champs touchés par l'utilisateur partent en base.
    const init = initialRef.current
    if (status !== init.status) changes.status = status
    if (clientName !== init.clientName)
      changes.client_name = clientName.trim() ? clientName.trim() : null
    if (matConfirme !== init.matConfirme) changes.mat_toit_confirme = matConfirme || null
    // Date de relance : suivie seulement pour « à revoir », effacée sinon.
    if (status === 'a_revoir') {
      if (revisitAt !== init.revisitAt) changes.revisit_at = revisitAt || null
    } else if (status !== init.status && init.revisitAt) {
      changes.revisit_at = null
    }
    const becameRdv = changes.status === 'rdv_pris'
    try {
      if (Object.keys(changes).length > 0) {
        await onUpdate(point.id, changes)
        // Instantané rafraîchi DÈS que l'update a réussi : si l'ajout de la
        // note échoue juste après (la sheet reste ouverte), un 2e
        // « Enregistrer » ne doit pas rejouer le statut — il journalisait un
        // DEUXIÈME point_events, porte comptée deux fois dans les stats
        // (contre-audit, bug 7).
        initialRef.current = {
          status,
          clientName,
          matConfirme,
          revisitAt: status === 'a_revoir' ? revisitAt : '',
        }
      }
      if (newNote.trim()) await onAddNote(point.id, newNote.trim())
      onOpenChange(false)
      toast.success('Point mis à jour')
      if (becameRdv) onRdvNeeded?.({ ...point, status: 'rdv_pris' })
    } catch (e) {
      console.error('Modification du point :', e)
      toast.error('Modification impossible — réseau, ou point d’un autre commercial')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!point) return
    setSaving(true)
    try {
      await onDelete(point.id)
      onOpenChange(false)
      toast('Point supprimé')
    } catch (e) {
      console.error('Suppression du point :', e)
      toast.error('Suppression impossible — réseau, ou point d’un autre commercial')
    } finally {
      setSaving(false)
    }
  }

  const current = STATUS_BY_VALUE[point.status]

  // Fiche maison : le cache du point d'abord, sinon le fetch à la volée.
  const annee = point.annee_construction ?? liveEnrich?.annee_construction ?? null
  const matCode = point.mat_toit ?? liveEnrich?.mat_toit ?? null
  const toitM2 = point.toit_surface_m2 ?? liveEnrich?.toit_surface_m2 ?? null
  const dpe = point.dpe_classe ?? liveEnrich?.dpe_classe ?? null
  const extra = point.maison_extra ?? liveEnrich?.maison_extra ?? null
  // Mesure LiDAR : affichée seulement si le verdict est fiable (statut ok) —
  // sinon la fiche garde l'estimation, sans mentir. La re-mesure à la volée
  // (liveLidar) PRIME sur le cache du point : quand elle a été déclenchée,
  // c'est que le cache était absent, périmé (version d'algo) ou en erreur —
  // et pour un point d'un collègue, le realtime ne corrigera pas toujours.
  const lidarStatut = liveLidar?.toit_lidar_statut ?? point.toit_lidar_statut ?? null
  // Badge = « LA MAISON » (corps principal, hors annexes/extensions — demande
  // du chef des ventes) ; repli sur le total pour les mesures anciennes.
  const lidarM2 =
    lidarStatut === 'ok'
      ? liveLidar
        ? liveLidar.toit_lidar_principal_m2 || liveLidar.toit_lidar_m2
        : point.toit_lidar_principal_m2 || point.toit_lidar_m2
      : null
  const lidarMillesime = liveLidar
    ? liveLidar.toit_lidar_millesime
    : (point.toit_lidar_millesime ?? null)
  // Maquette 3D : la re-mesure fraîche prime sur les pans du cache.
  const lidarPans =
    lidarStatut === 'ok' ? (liveLidar ? liveLidar.toit_lidar_pans : cachedPans) : null
  const hasHouseInfo = annee !== null || matCode !== null || toitM2 !== null || dpe !== null

  return (
    // Non modale : la carte reste visible et manipulable derrière (le point
    // sélectionné est recadré au-dessus de la sheet, voir MapView).
    // repositionInputs={false} : au focus d'un champ, vaul pose des styles
    // inline height/bottom calculés sur visualViewport — faux en PWA iOS
    // (sheet hors écran au clavier, hauteur rétrécie jamais restaurée après).
    // Le clavier se superpose et iOS scrolle le champ dans .drawer-body.
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={false} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">
              <span className="status-pill" style={{ background: current.color }} />
              {current.label}
            </span>
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          {(detail || point.address) && (
            <div className="drawer-meta">
              {point.address && (
                <span>
                  <MapPin size={13} /> {point.address}
                </span>
              )}
              {detail && (
                <span>
                  <Clock size={13} /> {formatDate(detail.created_at)}
                </span>
              )}
              {detail?.author_name && (
                <span>
                  <User size={13} /> {detail.author_name}
                </span>
              )}
            </div>
          )}

          {/* data-vaul-no-drag : le geste vertical DANS le contenu fait
              défiler la sheet au lieu de la tirer (vaul volait le scroll —
              fermer reste possible par la poignée / l'en-tête). */}
          <div className="drawer-body" data-vaul-no-drag>
          <p className="eyebrow field-label">Statut</p>
          <div className="chip-row">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`chip ${status === s.value ? 'is-active' : ''}`}
                style={{ ['--chip' as string]: s.color }}
                onClick={() => setStatus(s.value)}
              >
                <span className="chip-dot" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>

          <HouseBadges
            annee={annee}
            matCode={matCode}
            matConfirme={point.mat_toit_confirme}
            toitM2={toitM2}
            lidarM2={lidarM2}
            lidarMillesime={lidarMillesime}
            lidarPending={lidarPending && lidarM2 == null}
            dpe={dpe}
            extra={extra}
            lidarStatut={lidarStatut}
            lidarDiag={liveLidar ? liveLidar.toit_lidar_diag : point.toit_lidar_diag}
          />

          {lidarPans && (
            <>
              <Roof3D
                roof={lidarPans}
                wastePct={suggestedWastePct(matCode, point.mat_toit_confirme, lidarPans.aretes)}
              />
              <RoofDiagram roof={lidarPans} />
              <RoofReport
                roof={lidarPans}
                address={point.address}
                maisonM2={lidarM2}
                totalM2={liveLidar ? liveLidar.toit_lidar_m2 : point.toit_lidar_m2}
                millesime={lidarMillesime}
                wastePct={suggestedWastePct(matCode, point.mat_toit_confirme, lidarPans.aretes)}
              />
            </>
          )}

          {status === 'a_revoir' && (
            <>
              <p className="eyebrow field-label">Revoir le</p>
              <input
                className="field-input"
                type="date"
                value={revisitAt}
                onChange={(e) => setRevisitAt(e.target.value)}
              />
            </>
          )}

          <p className="eyebrow field-label">Client</p>
          <input
            className="field-input"
            type="text"
            placeholder="Nom (facultatif)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />

          <p className="eyebrow field-label">Toiture constatée</p>
          <select
            className="field-input"
            value={matConfirme}
            onChange={(e) => setMatConfirme(e.target.value)}
          >
            <option value="">— non confirmée (donnée fiscale) —</option>
            {CONFIRMED_MAT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <p className="eyebrow field-label">Notes</p>
          {shownNotes.length > 0 && (
            <ul className="note-history">
              {shownNotes.map((n) => (
                <li key={n.id} className="note-entry">
                  <span className="note-meta">
                    {n.author_name ?? 'Note'}
                    {n.created_at ? ` · ${formatDate(n.created_at)}` : ''}
                  </span>
                  <span className="note-body">{n.body}</span>
                </li>
              ))}
            </ul>
          )}
          <textarea
            className="field-input"
            placeholder={
              shownNotes.length
                ? 'Ajouter une note (la précédente est conservée)…'
                : 'Ex : repasser en soirée, portail bleu…'
            }
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
          />

          <div className="drawer-actions">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>
              <Trash2 size={16} /> Supprimer
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>

          {hasHouseInfo && (
            <p className="data-attribution">Données IGN BD TOPO · BDNB (CSTB)</p>
          )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
