import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { X, Trash2, Clock, User, MapPin, CalendarClock, Pencil, Phone, CalendarPlus, Navigation } from 'lucide-react'
import {
  getPointDetail,
  fetchPointNotes,
  fetchPointPans,
  type PointDetail,
  type PointNote,
} from '../data/points'
import { fetchPointAppointments } from '../data/appointments'
import { wazeUrl } from './ClientSheet'
import { firstNameOf } from '../domain/names'
import { APPOINTMENT_STATUS_META, type Appointment } from '../domain/appointments'
import {
  lidarNeedsMeasure,
  suggestedWastePct,
  type HouseEnrichment,
  type RoofData,
} from '../domain/house'
import type { LidarResult } from '../data/lidar'
import { HouseBadges } from './HouseBadges'
import { RoofModule } from './RoofModule'
import { isSupabaseConfigured } from '../lib/supabase'
import { useSession } from '../lib/session'
import { markerDataUrl } from '../config/markers'
import {
  DISPLAY_STATUSES,
  STATUS_BY_VALUE,
  sameDisplayStatus,
  type PointStatus,
} from '../domain/status'
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
      client_phone?: string | null
      revisit_at?: string | null
      mat_toit_confirme?: string | null
    },
  ) => Promise<void>
  /** Ajoute une note au journal de la maison (jamais d'écrasement). */
  onAddNote: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Ouvre le formulaire de RDV : création (pas de 2e argument) ou ÉDITION
      du RDV « à venir » passé en 2e argument (décaler une date, 29/07). */
  onRdvNeeded?: (point: MapPoint, existing?: Appointment) => void
  /** Incrémenté quand un RDV vient d'être enregistré (formulaire par-dessus
      la fiche) : le bloc « Rendez-vous » se rafraîchit sans rouvrir. */
  apptsVersion?: number
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

/** Clé jour LOCALE à J+n (le champ date attend YYYY-MM-DD). */
function dayPlus(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** « Sam. 26 juil. · 16:00 » — l'heure séparée par un point médian. */
function formatRdvWhen(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`
}

export function PointDetailSheet({
  open,
  point,
  onOpenChange,
  onUpdate,
  onAddNote,
  onDelete,
  onRdvNeeded,
  apptsVersion,
}: Props) {
  const { profile: me } = useSession()
  const [detail, setDetail] = useState<PointDetail | null>(null)
  const [status, setStatus] = useState<PointStatus>('absent')
  // Chips de statut repliées derrière « Modifier » (réorganisation briac
  // 25/07) : le statut est posé à la pose, il change rarement ensuite.
  const [statusOpen, setStatusOpen] = useState(false)
  const [history, setHistory] = useState<PointNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [revisitAt, setRevisitAt] = useState('')
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
  // Suppression en deux taps (voir remove()).
  const [confirmDelete, setConfirmDelete] = useState(false)
  // RDV liés au point (bloc « Rendez-vous », audit UX B1) — null = pas encore
  // chargés : le bandeau « Aucun RDV planifié » n'accuse pas pendant le fetch.
  const [appts, setAppts] = useState<Appointment[] | null>(null)

  // Instantané des valeurs INITIALES du formulaire : la sauvegarde n'envoie
  // que ce que l'utilisateur a touché DANS CETTE SESSION — comparer à `point`
  // (mis à jour par le realtime) réécrivait l'ancien statut par-dessus le
  // changement d'un collègue, et journalisait un faux événement (audit).
  const initialRef = useRef({
    status: 'absent' as PointStatus,
    clientName: '',
    clientPhone: '',
    revisitAt: '',
  })

  useEffect(() => {
    if (!open || !point) return
    initialRef.current = {
      status: point.status,
      clientName: point.client_name ?? '',
      clientPhone: point.client_phone ?? '',
      revisitAt: point.revisit_at ?? '',
    }
    setStatus(point.status)
    setClientName(point.client_name ?? '')
    setClientPhone(point.client_phone ?? '')
    setRevisitAt(point.revisit_at ?? '')
    setNewNote('')
    setConfirmDelete(false)
    setStatusOpen(false)
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

  // RDV liés (effet séparé : il rejoue aussi quand un RDV vient d'être
  // enregistré par-dessus la fiche, via apptsVersion).
  useEffect(() => {
    setAppts(null)
    if (!open || !point || !isSupabaseConfigured || point.id.startsWith('temp-')) return
    let active = true
    fetchPointAppointments(point.id)
      .then((as) => {
        if (active) setAppts(as)
      })
      .catch((e) => console.error('RDV du point :', e))
    return () => {
      active = false
    }
    // Même logique que l'effet principal : l'ID et l'ouverture, pas l'objet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.id, open, apptsVersion])

  // RDV mis en avant : le prochain « à venir » (1 h de grâce : un RDV en
  // cours reste LE rendez-vous), sinon le plus récent avec son issue.
  const shownRdv = useMemo(() => {
    if (!appts?.length) return null
    const upcoming = appts.find(
      (a) => a.status === 'a_venir' && new Date(a.scheduled_at).getTime() >= Date.now() - 3_600_000,
    )
    return upcoming ?? appts[appts.length - 1]
  }, [appts])
  // RDV encore modifiable = « à venir » (même passé de date : un RDV oublié
  // se DÉCALE, on n'en recrée pas un deuxième — piège corrigé le 29/07).
  const editableRdv = shownRdv?.status === 'a_venir' ? shownRdv : null

  if (!point) return null

  const init = initialRef.current
  const dirty =
    status !== init.status ||
    clientName !== init.clientName ||
    clientPhone !== init.clientPhone ||
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
            author_id: detail?.created_by ?? null,
            author_name: detail?.author_name ?? null,
          },
        ]
      : history

  // Méta d'une note : date seule pour SES notes, prénom (jamais l'email) pour
  // celles d'un collègue — l'adresse mail mangeait la ligne (retour briac).
  const noteMeta = (n: PointNote): string => {
    const when = n.created_at ? formatDate(n.created_at) : ''
    if (!n.author_id || n.author_id === me?.id) return when
    const who = firstNameOf(n.author_name)
    return who ? (when ? `${who} · ${when}` : who) : when
  }

  async function save() {
    if (!point) return
    setSaving(true)
    const changes: {
      status?: PointStatus
      client_name?: string | null
      client_phone?: string | null
      revisit_at?: string | null
    } = {}
    // Diff contre l'instantané INITIAL (pas contre `point`, mis à jour par le
    // realtime) : seuls les champs touchés par l'utilisateur partent en base.
    const init = initialRef.current
    if (status !== init.status) changes.status = status
    if (clientName !== init.clientName)
      changes.client_name = clientName.trim() ? clientName.trim() : null
    if (clientPhone !== init.clientPhone)
      changes.client_phone = clientPhone.trim() ? clientPhone.trim() : null
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
          clientPhone,
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
    // Deux taps : « Supprimer » est pleine largeur, à 10 px d'« Enregistrer »,
    // pile où le pouce arrive lancé en fin de scroll — un tap raté effaçait
    // définitivement le point ET son journal pour toute l'équipe
    // (contre-audit, bug 20).
    if (!confirmDelete) {
      setConfirmDelete(true)
      window.setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
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
              {/* Dernière VISITE, libellée (audit UX A30) : la date de pose
                  brute trompait sur « je retente ou pas ? » d'un point revisité. */}
              {(point.visited_at || detail) && (
                <span title="Dernière visite commerciale">
                  <Clock size={13} /> Vu le {formatDate(point.visited_at ?? detail!.created_at)}
                </span>
              )}
              {/* Auteur affiché SEULEMENT si ce n'est pas soi (décision briac
                  25/07) : utile au manager sur le point d'un autre commercial,
                  bruit pour le commercial qui ne voit que ses points. */}
              {detail?.author_name && detail.created_by !== me?.id && (
                <span>
                  <User size={13} /> {detail.author_name}
                </span>
              )}
              {/* Appel direct depuis l'en-tête (audit UX B10) — masqué quand
                  le bloc RDV affiche déjà « Appeler » (doublon, briac 25/07). */}
              {point.client_phone && !shownRdv && (
                <a href={`tel:${point.client_phone}`}>
                  <Phone size={13} /> {point.client_phone}
                </a>
              )}
            </div>
          )}

          {/* data-vaul-no-drag : le geste vertical DANS le contenu fait
              défiler la sheet au lieu de la tirer (vaul volait le scroll —
              fermer reste possible par la poignée / l'en-tête). */}
          <div className="drawer-body" data-vaul-no-drag>
          {/* Bloc « Rendez-vous » en tête (audit UX B1) : la fiche d'un point
              « RDV pris » n'affichait ni date ni heure — il fallait fouiller
              l'agenda pour savoir quand on est attendu. */}
          {shownRdv && (
            <div className="rdv-block">
              <span className="rdv-block-head">
                <span className="rdv-when">
                  <CalendarClock size={15} strokeWidth={2} />
                  {formatRdvWhen(shownRdv.scheduled_at)}
                </span>
                {shownRdv.status !== 'a_venir' && (
                  <span
                    className="rdv-outcome"
                    style={{ color: APPOINTMENT_STATUS_META[shownRdv.status].color }}
                  >
                    {APPOINTMENT_STATUS_META[shownRdv.status].label}
                  </span>
                )}
              </span>
              <span className="rdv-actions">
                {(shownRdv.client_phone ?? point.client_phone) && (
                  <a className="text-btn" href={`tel:${shownRdv.client_phone ?? point.client_phone}`}>
                    <Phone size={14} /> Appeler
                  </a>
                )}
                {/* « Y aller » (Waze, coordonnées du point) — remplace « Voir
                    dans l'agenda » (décision briac 25/07). */}
                <a
                  className="text-btn"
                  href={wazeUrl(point, point.address)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Navigation size={14} /> Y aller
                </a>
                {/* Décaler le RDV là où sa date s'affiche (retour briac
                    29/07) — édition, jamais un 2e RDV. */}
                {editableRdv && onRdvNeeded && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => onRdvNeeded(point, editableRdv)}
                  >
                    <Pencil size={14} /> Modifier
                  </button>
                )}
              </span>
            </div>
          )}
          {/* Trou silencieux (audit UX B1) : un point « RDV pris » SANS RDV en
              agenda (formulaire balayé à la pose) — personne ne s'y présente. */}
          {appts !== null &&
            point.status === 'rdv_pris' &&
            !appts.some((a) => a.status === 'a_venir') && (
              <div className="rdv-missing">
                <span>Aucun RDV planifié pour ce point</span>
                {onRdvNeeded && (
                  <button type="button" className="text-btn" onClick={() => onRdvNeeded(point)}>
                    <CalendarPlus size={14} /> Planifier
                  </button>
                )}
              </div>
            )}
          {/* Client d'abord (réorganisation briac 25/07) : le contexte —
              client puis maison — avant les actions d'édition. */}
          {(status === 'a_revoir' ||
            status === 'rdv_pris' ||
            status === 'vendu' ||
            status === 'ancien_client') && (
            <>
              <div className="field-label-row">
                <p className="eyebrow field-label">Client</p>
                {/* RDV sans le détour statut → Enregistrer (audit UX B1).
                    MASQUÉ quand un RDV « à venir » existe : ce bouton créait
                    alors un DOUBLON — le décalage passe par « Modifier » du
                    bloc RDV (piège corrigé le 29/07). */}
                {onRdvNeeded && isSupabaseConfigured && !point.id.startsWith('temp-') && !editableRdv && (
                  <button type="button" className="text-btn" onClick={() => onRdvNeeded(point)}>
                    <CalendarPlus size={14} /> RDV
                  </button>
                )}
              </div>
              {/* Nom + téléphone côte à côte (audit UX B10) : le « voilà mon
                  06 » d'un « à revoir » a enfin sa place hors note libre. */}
              <div className="field-grid">
                <input
                  className="field-input"
                  type="text"
                  placeholder="Nom (facultatif)"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
                <input
                  className="field-input"
                  type="tel"
                  placeholder="06 …"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </div>
              {/* Date de relance DANS la section client (retour briac 25/07),
                  sans presets — le champ date natif suffit. */}
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
            </>
          )}

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
            hideMeasured={lidarPans !== null}
          />

          {lidarPans && (
            // Replié par défaut : à la porte, la 3D ne doit pas taxer la
            // pose (statut, note, Enregistrer) — audit UX, B2.
            <RoofModule
              roof={lidarPans}
              wastePct={suggestedWastePct(matCode, point.mat_toit_confirme, lidarPans.aretes)}
              address={point.address}
              maisonM2={lidarM2}
              totalM2={liveLidar ? liveLidar.toit_lidar_m2 : point.toit_lidar_m2}
              millesime={lidarMillesime}
            />
          )}

          {/* Notes : saisies à CHAQUE visite (audit UX A12). */}
          <p className="eyebrow field-label">Notes</p>
          {shownNotes.length > 0 && (
            <ul className="note-history">
              {shownNotes.map((n) => (
                <li key={n.id} className="note-entry">
                  {noteMeta(n) && <span className="note-meta">{noteMeta(n)}</span>}
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

          {/* Statut COMPACT (réorganisation briac 25/07) : posé à la pose, il
              change rarement à la réouverture — les 6 chips ne s'affichent
              qu'au tap sur « Modifier ». */}
          {!statusOpen ? (
            <div className="status-line">
              <span className="eyebrow field-label">Statut</span>
              <span className="status-line-current">
                <img className="chip-marker" src={markerDataUrl(status)} alt="" />
                {STATUS_BY_VALUE[status].label}
              </span>
              <button type="button" className="text-btn" onClick={() => setStatusOpen(true)}>
                Modifier
              </button>
            </div>
          ) : (
            <>
              <p className="eyebrow field-label">Statut</p>
              <div className="chip-row">
                {DISPLAY_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`chip ${sameDisplayStatus(status, s.value) ? 'is-active' : ''}`}
                    style={{ ['--chip' as string]: s.color }}
                    onClick={() => {
                      // Re-taper « Client » sur un point déjà client (vendu
                      // OU ancien_client) ne réécrit pas la valeur : le
                      // journal garde vente vs ancien client (fusion 29/07).
                      setStatus(sameDisplayStatus(status, s.value) ? status : s.value)
                      // « À revoir » sans date ne remonte JAMAIS dans les
                      // relances : J+7 pré-rempli (modifiable) — audit UX A4.
                      if (s.value === 'a_revoir' && !revisitAt) setRevisitAt(dayPlus(7))
                    }}
                  >
                    <img className="chip-marker" src={markerDataUrl(s.value)} alt="" />
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}


          {/* Destructif déclassé : plus de rangée à égalité avec Enregistrer,
              où le pouce arrivait lancé en fin de scroll (audit UX, A3).
              La confirmation en deux taps est conservée. */}
          <button
            type="button"
            className="text-btn danger drawer-delete"
            onClick={remove}
            disabled={saving}
          >
            <Trash2 size={14} /> {confirmDelete ? 'Confirmer la suppression ?' : 'Supprimer le point'}
          </button>

          {hasHouseInfo && (
            <p className="data-attribution">Données IGN BD TOPO · BDNB (CSTB)</p>
          )}

          {/* Sticky : l'action de tous les jours reste visible sans scroller
              (le bas de fiche partait sous le pli dès que la 3D était ouverte). */}
          <div className="drawer-footer">
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
