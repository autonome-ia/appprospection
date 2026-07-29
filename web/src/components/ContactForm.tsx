import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { MapPin, X } from 'lucide-react'
import { searchAddresses, type AddressResult } from './AddressSearch'
import { findPointByAddress, insertPoint, updatePoint } from '../data/points'
import { STATUS_BY_VALUE } from '../domain/status'
import { markerDataUrl } from '../config/markers'
import type { MapPoint, Profile } from '../domain/types'

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
  /** Point créé — le parent recharge, ferme, et enchaîne (RDV si RDV pris). */
  onCreated: (point: MapPoint, status: 'rdv_pris' | 'a_revoir') => void
  /** « Voir » le point existant quand l'adresse est déjà prise. */
  onShowOnMap?: (target: { pointId: string; lng: number; lat: number }) => void
}

const pad = (n: number) => String(n).padStart(2, '0')
/** J+7 par défaut pour la relance (même convention que la fiche point). */
function defaultRevisit(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ContactForm({ profile, onOpenChange, onCreated, onShowOnMap }: Props) {
  const [status, setStatus] = useState<'rdv_pris' | 'a_revoir'>('rdv_pris')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [revisitAt, setRevisitAt] = useState(defaultRevisit)
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
      const point = await insertPoint(profile, chosen.lng, chosen.lat, status, note.trim() || null)
      // Infos client dans la foulée (insertPoint ne les porte pas) — l'échec
      // n'est pas silencieux mais le point existe : la fiche permet de
      // compléter à la main.
      try {
        await updatePoint(profile, point.id, {
          client_name: name.trim() || null,
          client_phone: phone.trim() || null,
          ...(status === 'a_revoir' && revisitAt ? { revisit_at: revisitAt } : {}),
        })
      } catch (e) {
        console.error('Infos client du contact :', e)
        toast.error('Contact créé, mais infos client non enregistrées — complétez sa fiche')
      }
      onCreated(
        { ...point, client_name: name.trim() || null, client_phone: phone.trim() || null },
        status,
      )
    } catch (e) {
      console.error('Création du contact :', e)
      toast.error('Création impossible — vérifiez le réseau')
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
              <p className="field-hint">Choisissez l’adresse dans la liste — elle place la maison sur la carte.</p>
            )}

            <p className="eyebrow field-label">Statut</p>
            <div className="chip-row">
              {(['rdv_pris', 'a_revoir'] as const).map((s) => (
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
                disabled={!chosen || saving}
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
