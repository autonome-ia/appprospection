import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { MapPin, X } from 'lucide-react'
import { searchAddresses, type AddressResult } from './AddressSearch'
import { TIME_SLOTS } from './AppointmentForm'
import { findPointByAddress, insertPoint } from '../data/points'
import { createAppointment } from '../data/appointments'
import { fetchOrgProfiles, type OrgProfile } from '../data/profiles'
import { STATUS_BY_VALUE } from '../domain/status'
import { markerDataUrl } from '../config/markers'
import { isSecretaireRole, type MapPoint, type Profile } from '../domain/types'

// -----------------------------------------------------------------------------
// Saisie manuelle d'un contact (vue Contacts, 27/07) : « poser un point sans
// être devant la maison ». L'adresse BAN choisie donne les coordonnées — le
// point se crée par la MÊME chaîne que la carte (insertPoint : journal stats,
// adresse inverse, fiche maison, mesure LiDAR). Statuts possibles : ceux de
// la liste Contacts (RDV pris / À revoir). Anti-doublon : refus si un point
// existe déjà à l'adresse exacte (décision briac).
// -----------------------------------------------------------------------------

interface Props {
  profile: Profile
  onOpenChange: (open: boolean) => void
  /** Point créé (RDV éventuel compris) — le parent recharge et ferme. */
  onCreated: (point: MapPoint) => void
  /** « Voir » le point existant quand l'adresse est déjà prise. */
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** J+7 par défaut pour la relance (même convention que la fiche point). */
function defaultRevisit(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return toDateInput(d)
}
/** Défaut du RDV : prochaine heure pile — repli 09:00 du lendemain quand la
    prochaine heure sort des créneaux (soirée). */
function defaultRdv(): { date: string; time: string } {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  const time = `${pad(d.getHours())}:00`
  if (TIME_SLOTS.includes(time)) return { date: toDateInput(d), time }
  d.setDate(d.getDate() + 1)
  return { date: toDateInput(d), time: '09:00' }
}

export function ContactForm({ profile, onOpenChange, onCreated, onShowOnMap }: Props) {
  const [status, setStatus] = useState<'rdv_pris' | 'a_revoir' | 'ancien_client'>('rdv_pris')
  // Secrétaire (étape 4) : le contact est créé AU NOM d'un commercial —
  // sinon sa carte privée et sa liste Contacts ne le verraient jamais. Le
  // sélecteur est OBLIGATOIRE pour elle ; le RDV lié suit le même titulaire.
  const secretaire = isSecretaireRole(profile.role)
  const [ownerId, setOwnerId] = useState('')
  const [team, setTeam] = useState<OrgProfile[]>([])
  useEffect(() => {
    if (!secretaire) return
    fetchOrgProfiles()
      .then((profs) =>
        setTeam(
          profs
            .filter((p) => !p.disabled_at && p.role !== 'secretaire')
            .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')),
        ),
      )
      .catch((e) => console.error('Profils :', e))
  }, [secretaire])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [revisitAt, setRevisitAt] = useState(defaultRevisit)
  const [rdvDefaults] = useState(defaultRdv)
  const [rdvDate, setRdvDate] = useState(rdvDefaults.date)
  const [rdvTime, setRdvTime] = useState(rdvDefaults.time)
  // Adresse : le texte ET la suggestion BAN choisie (les coordonnées) — toute
  // retouche du texte invalide le choix, sans coordonnées on ne crée rien.
  const [address, setAddress] = useState('')
  const [chosen, setChosen] = useState<AddressResult | null>(null)
  const [addrFocus, setAddrFocus] = useState(false)
  const [addrResults, setAddrResults] = useState<AddressResult[]>([])
  const [addrOpen, setAddrOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!addrFocus) return
    const q = address.trim()
    if (q.length < 3) {
      setAddrResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      searchAddresses(q, ctrl.signal)
        .then((rs) => {
          setAddrResults(rs)
          setAddrOpen(true)
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') console.error('Recherche adresse :', e)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [address, addrFocus])

  const chooseAddress = (r: AddressResult) => {
    setAddress(r.label)
    setChosen(r)
    setAddrResults([])
    setAddrOpen(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  async function save() {
    if (!chosen || saving) return
    setSaving(true)
    try {
      // Anti-doublon : adresse exacte déjà occupée par un point (tout statut).
      const existing = await findPointByAddress(chosen.label)
      if (existing) {
        toast.error('Un point existe déjà à cette adresse', {
          description: `${STATUS_BY_VALUE[existing.status]?.label ?? existing.status} · ${existing.address}`,
          action: onShowOnMap
            ? {
                label: 'Voir',
                onClick: () => {
                  onOpenChange(false)
                  onShowOnMap({ pointId: existing.id, lng: existing.lng, lat: existing.lat })
                },
              }
            : undefined,
        })
        return
      }
      // TOUT dans le même insert (adresse BAN comprise — pas de géocodage
      // inverse) : indispensable pour la secrétaire, qui crée au nom d'un
      // commercial et ne peut plus UPDATE le point ensuite (RLS).
      const point = await insertPoint(profile, chosen.lng, chosen.lat, status, note.trim() || null, {
        ...(secretaire && ownerId ? { createdBy: ownerId } : {}),
        address: chosen.label,
        client_name: name.trim() || null,
        client_phone: phone.trim() || null,
        ...(status === 'a_revoir' && revisitAt ? { revisit_at: revisitAt } : {}),
      })
      // RDV créé DANS LE MÊME formulaire (retour briac 27/07 : le second
      // modal redemandait ce qui venait d'être saisi). La note reste sur le
      // point (note terrain) : l'agenda l'affiche déjà en contexte.
      let rdvOk = true
      if (status === 'rdv_pris') {
        try {
          await createAppointment(profile, {
            point_id: point.id,
            scheduled_at: new Date(`${rdvDate}T${rdvTime}`).toISOString(),
            address: chosen.label,
            client_name: name.trim() || null,
            client_phone: phone.trim() || null,
            notes: null,
            ...(secretaire && ownerId ? { commercial_id: ownerId } : {}),
          })
        } catch (e) {
          rdvOk = false
          console.error('RDV du contact :', e)
          // Filet existant : la fiche d'un « RDV pris » sans RDV propose
          // « Planifier » — le trou n'est pas silencieux.
          toast.error('Contact créé, mais RDV non enregistré : ouvrez sa fiche pour planifier')
        }
      }
      if (status !== 'rdv_pris' || rdvOk) {
        toast.success(status === 'rdv_pris' ? 'Contact créé, RDV à l’agenda' : 'Contact créé', {
          action: onShowOnMap
            ? {
                label: 'Voir sur la carte',
                onClick: () => onShowOnMap({ pointId: point.id, lng: point.lng, lat: point.lat }),
              }
            : undefined,
        })
      }
      onCreated({ ...point, client_name: name.trim() || null, client_phone: phone.trim() || null })
    } catch (e) {
      console.error('Création du contact :', e)
      toast.error('Création impossible : vérifiez le réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer.Root open onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">Nouveau contact</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onOpenChange(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
            <p className="eyebrow field-label">Adresse</p>
            <input
              className="field-input"
              type="text"
              placeholder="Adresse de la maison…"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                setChosen(null) // texte retouché = coordonnées à re-choisir
              }}
              onFocus={() => setAddrFocus(true)}
              onBlur={() => {
                setAddrFocus(false)
                window.setTimeout(() => setAddrOpen(false), 150)
              }}
            />
            {addrOpen && addrResults.length > 0 && (
              // Liste EN FLUX (pas de dropdown absolu — même raison que le
              // formulaire RDV : le corps de la sheet défile).
              <ul className="address-results form-address-results">
                {addrResults.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseAddress(r)}
                    >
                      <MapPin size={15} strokeWidth={1.8} className="address-result-icon" />
                      <span className="address-texts">
                        <span className="address-label">{r.label}</span>
                        {r.context && <span className="address-context">{r.context}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {address.trim().length > 0 && !chosen && (
              <p className="field-hint">Choisissez l’adresse dans la liste : elle place la maison sur la carte.</p>
            )}

            {secretaire && (
              <>
                <p className="eyebrow field-label">Pour quel commercial</p>
                <select
                  className="field-input"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                >
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {team.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? 'Sans nom'}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  Le contact et son RDV appartiendront à ce commercial (sa carte, ses stats).
                </p>
              </>
            )}

            <p className="eyebrow field-label">Statut</p>
            {/* « Client » (fusion 29/07, valeur `ancien_client` — jamais une
                vente au tunnel) : ressaisir les maisons déjà vendues depuis
                le canapé — ni RDV ni relance, juste les coordonnées. */}
            <div className="chip-row">
              {(['rdv_pris', 'a_revoir', 'ancien_client'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip ${status === s ? 'is-active' : ''}`}
                  style={{ ['--chip' as string]: STATUS_BY_VALUE[s].color }}
                  onClick={() => setStatus(s)}
                >
                  <img className="chip-marker" src={markerDataUrl(s)} alt="" />
                  {STATUS_BY_VALUE[s].label}
                </button>
              ))}
            </div>

            <div className="field-grid">
              <div>
                <p className="eyebrow field-label">Client</p>
                <input
                  className="field-input"
                  type="text"
                  placeholder="Nom (facultatif)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <p className="eyebrow field-label">Téléphone</p>
                <input
                  className="field-input"
                  type="tel"
                  placeholder="06…"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

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

            {status === 'rdv_pris' && (
              <div className="field-grid">
                <div>
                  <p className="eyebrow field-label">RDV le</p>
                  <input
                    className="field-input"
                    type="date"
                    value={rdvDate}
                    onChange={(e) => setRdvDate(e.target.value)}
                  />
                </div>
                <div>
                  <p className="eyebrow field-label">Heure</p>
                  <select
                    className="field-input"
                    value={rdvTime}
                    onChange={(e) => setRdvTime(e.target.value)}
                  >
                    {TIME_SLOTS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <p className="eyebrow field-label">Note</p>
            <textarea
              className="field-input"
              rows={2}
              placeholder="Contexte, consigne… (facultatif)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="drawer-footer">
              <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                // Date de RDV vidée à la main : sans elle le RDV serait
                // invalide — on verrouille plutôt que d'échouer à moitié.
                // Secrétaire : titulaire obligatoire (le contact doit
                // appartenir à un commercial).
                disabled={
                  !chosen || saving || (status === 'rdv_pris' && !rdvDate) || (secretaire && !ownerId)
                }
                onClick={() => void save()}
              >
                {saving ? 'Création…' : 'Créer le contact'}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
