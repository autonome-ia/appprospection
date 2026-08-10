import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { Check, Copy, RefreshCw, Share2, X } from 'lucide-react'
import {
  fetchOrgProfiles,
  setMemberDisabled,
  updateMemberColor,
  updateMemberName,
  updateMemberRole,
  type OrgProfile,
} from '../data/profiles'
import { fetchInviteCode, fetchOrgName, regenInviteCode } from '../data/team'
import { colorForCommercial, TEAM_PALETTE } from '../domain/colors'
import { ROLE_LABELS, roleLabel, type Profile, type UserRole } from '../domain/types'

/**
 * Écran « Équipe » (chantier Équipe, étape 3) — sheet vaul (gabarit commun).
 * Manager : code d'invitation partageable (+ rotation), changer le rôle d'un
 * membre, désactiver/réactiver un compte (2 taps, jamais soi-même).
 * Chef des ventes : la même chose en LECTURE (code partageable inclus).
 * La base a le dernier mot (RLS + trigger) : tout refus est montré, jamais
 * un faux succès.
 */

const ROLE_ORDER: UserRole[] = ['manager', 'chef_ventes', 'secretaire', 'commercial']

function initials(name: string | null): string {
  const parts = (name ?? '?').trim().split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

export function TeamSheet({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  profile: Profile
}) {
  const isManager = profile.role === 'manager'
  const [members, setMembers] = useState<OrgProfile[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /** Panneau d'édition déplié (id du membre) — inline, pas de 2e drawer. */
  const [openId, setOpenId] = useState<string | null>(null)
  /** Nom en cours d'édition dans le panneau (les comptes d'avant le chantier
      Équipe portaient leur EMAIL en guise de nom — le manager corrige ici). */
  const [nameEdit, setNameEdit] = useState('')
  const [busy, setBusy] = useState(false)
  /** Confirmations 2 taps (audit UX : jamais de dialogue système). */
  const [armRegen, setArmRegen] = useState(false)
  const [armDisable, setArmDisable] = useState<string | null>(null)
  const armTimer = useRef<number | undefined>(undefined)

  const arm = (setter: () => void) => {
    window.clearTimeout(armTimer.current)
    setter()
    armTimer.current = window.setTimeout(() => {
      setArmRegen(false)
      setArmDisable(null)
    }, 3500)
  }

  const load = () => {
    Promise.all([fetchOrgProfiles(), fetchInviteCode(), fetchOrgName()])
      .then(([profs, c, name]) => {
        setMembers(profs)
        setCode(c)
        setOrgName(name)
        setLoadError(false)
      })
      .catch((e) => {
        console.error('Équipe :', e)
        setLoadError(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setOpenId(null)
    setArmRegen(false)
    setArmDisable(null)
    load()
  }, [open])

  // Message d'invitation : envoyé PAR le téléphone du manager (partage natif
  // — WhatsApp/SMS/Mail). Pas d'email automatique : il faudrait un serveur et
  // la clé secrète ; le partage natif est plus direct et plus personnel.
  const inviteText = code
    ? `Rejoins l’équipe ${orgName ?? 'de ton agence'} sur AppProspection :\n${window.location.origin}\n\nCode d’invitation : ${code}\nSur l’écran d’accueil, choisis « J’ai un code d’invitation — créer mon compte ».`
    : null

  const share = async () => {
    if (!inviteText) return
    if (navigator.share) {
      try {
        await navigator.share({ text: inviteText })
      } catch {
        /* partage annulé */
      }
      return
    }
    await navigator.clipboard.writeText(inviteText)
    toast.success('Message d’invitation copié')
  }

  const copyCode = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    toast.success('Code copié')
  }

  const regen = async () => {
    if (!armRegen) {
      arm(() => setArmRegen(true))
      return
    }
    setArmRegen(false)
    setBusy(true)
    try {
      const next = await regenInviteCode()
      setCode(next)
      toast.success('Nouveau code généré — l’ancien ne fonctionne plus')
    } catch (e) {
      console.error('Rotation du code :', e)
      toast.error('Impossible de générer un nouveau code')
    } finally {
      setBusy(false)
    }
  }

  const openPanel = (m: OrgProfile, expanded: boolean) => {
    setOpenId(expanded ? null : m.id)
    setNameEdit(expanded ? '' : (m.full_name ?? ''))
  }

  const saveName = async (m: OrgProfile) => {
    const next = nameEdit.trim()
    if (busy || !next || next === (m.full_name ?? '')) return
    setBusy(true)
    try {
      await updateMemberName(m.id, next)
      toast.success('Nom mis à jour')
      load()
    } catch (e) {
      console.error('Nom du membre :', e)
      toast.error('Modification refusée — réservé au manager')
    } finally {
      setBusy(false)
    }
  }

  const changeColor = async (m: OrgProfile, color: string) => {
    if (busy || color === m.color) return
    setBusy(true)
    try {
      await updateMemberColor(m.id, color)
      toast.success('Couleur mise à jour')
      load()
    } catch (e) {
      console.error('Couleur du membre :', e)
      toast.error('Modification refusée — réservé au manager')
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (m: OrgProfile, role: UserRole) => {
    if (busy || role === m.role) return
    setBusy(true)
    try {
      await updateMemberRole(m.id, role)
      toast.success(`${m.full_name ?? 'Le membre'} est maintenant ${ROLE_LABELS[role].toLowerCase()}`)
      load()
    } catch (e) {
      console.error('Changement de rôle :', e)
      toast.error('Changement refusé — réservé au manager')
    } finally {
      setBusy(false)
    }
  }

  const toggleDisabled = async (m: OrgProfile) => {
    const disabling = !m.disabled_at
    if (disabling && armDisable !== m.id) {
      arm(() => setArmDisable(m.id))
      return
    }
    setArmDisable(null)
    setBusy(true)
    try {
      await setMemberDisabled(m.id, disabling)
      toast.success(
        disabling
          ? `Compte de ${m.full_name ?? 'ce membre'} désactivé`
          : `Compte de ${m.full_name ?? 'ce membre'} réactivé`,
      )
      load()
    } catch (e) {
      console.error('Désactivation :', e)
      toast.error('Modification refusée — réservé au manager')
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...members].sort((a, b) => {
    // Désactivés en fin de liste, puis par rôle (managers d'abord), puis nom.
    if (!!a.disabled_at !== !!b.disabled_at) return a.disabled_at ? 1 : -1
    const ra = ROLE_ORDER.indexOf(a.role)
    const rb = ROLE_ORDER.indexOf(b.role)
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb)
    return (a.full_name ?? '').localeCompare(b.full_name ?? '')
  })

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />
          <div className="drawer-header">
            <span className="drawer-title">Équipe</span>
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body" data-vaul-no-drag>
            {loadError && (
              <div className="load-error">
                <span>Impossible de charger l’équipe.</span>
                <button type="button" className="text-btn" onClick={load}>
                  Réessayer
                </button>
              </div>
            )}

            {/* --- Code d'invitation --- */}
            {code && (
              <div className="team-invite">
                <p className="eyebrow">Code d’invitation</p>
                <div className="team-code-row">
                  <span className="team-code tnum">{code}</span>
                  <button type="button" className="icon-btn" onClick={copyCode} aria-label="Copier le code">
                    <Copy size={17} strokeWidth={1.9} />
                  </button>
                </div>
                <p className="team-invite-hint">
                  Un nouveau membre crée son compte avec ce code — il arrive « commercial », tu
                  choisis son rôle ici ensuite.
                </p>
                <div className="team-invite-actions">
                  <button type="button" className="btn btn-primary" onClick={share}>
                    <Share2 size={16} strokeWidth={2} />
                    Inviter
                  </button>
                  {isManager && (
                    <button
                      type="button"
                      className={`btn btn-ghost ${armRegen ? 'is-arm-danger' : ''}`}
                      onClick={regen}
                      disabled={busy}
                    >
                      <RefreshCw size={15} strokeWidth={2} />
                      {armRegen ? 'Confirmer ?' : 'Nouveau code'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* --- Membres --- */}
            <p className="eyebrow section-title">
              Membres{members.length > 0 && ` · ${members.length}`}
            </p>
            {loading && (
              <div aria-hidden="true">
                <span className="sk sk-row" />
                <span className="sk sk-row" />
              </div>
            )}
            {sorted.map((m) => {
              const me = m.id === profile.id
              const expandable = isManager && !me
              const expanded = openId === m.id
              return (
                <div key={m.id} className={`team-member ${m.disabled_at ? 'is-off' : ''}`}>
                  <button
                    type="button"
                    className="team-row"
                    onClick={expandable ? () => openPanel(m, expanded) : undefined}
                    disabled={!expandable}
                  >
                    <span
                      className="avatar team-avatar"
                      style={{ background: colorForCommercial(m.id, m.color), color: '#fff' }}
                    >
                      {initials(m.full_name)}
                    </span>
                    <span className="team-texts">
                      <span className="team-name">
                        {m.full_name ?? 'Sans nom'}
                        {me && <span className="team-me"> (toi)</span>}
                      </span>
                      <span className="team-role">
                        {roleLabel(m.role)}
                        {m.disabled_at && ' · désactivé'}
                      </span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="team-panel">
                      <p className="eyebrow field-label">Nom affiché</p>
                      <div className="team-name-edit">
                        <input
                          className="field-input"
                          type="text"
                          placeholder="Prénom Nom"
                          value={nameEdit}
                          onChange={(e) => setNameEdit(e.target.value)}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => void saveName(m)}
                          disabled={busy || !nameEdit.trim() || nameEdit.trim() === (m.full_name ?? '')}
                          aria-label="Enregistrer le nom"
                        >
                          <Check size={17} strokeWidth={2.2} />
                        </button>
                      </div>
                      {/* Couleur d'agenda (refonte 10/08) : le manager arbitre
                          — deux commerciaux ne prennent pas la même teinte. */}
                      <p className="eyebrow field-label">Couleur d’agenda</p>
                      <div className="team-swatches">
                        {TEAM_PALETTE.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`team-swatch ${colorForCommercial(m.id, m.color) === c ? 'is-active' : ''}`}
                            style={{ background: c }}
                            onClick={() => void changeColor(m, c)}
                            disabled={busy}
                            aria-label={`Couleur ${c}`}
                          />
                        ))}
                      </div>

                      <p className="eyebrow field-label">Rôle</p>
                      <div className="chip-row">
                        {ROLE_ORDER.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={`chip ${m.role === r ? 'is-active' : ''}`}
                            onClick={() => changeRole(m, r)}
                            disabled={busy}
                          >
                            {ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={`team-danger ${armDisable === m.id ? 'is-armed' : ''}`}
                        onClick={() => toggleDisabled(m)}
                        disabled={busy}
                      >
                        {m.disabled_at
                          ? 'Réactiver le compte'
                          : armDisable === m.id
                            ? 'Confirmer la désactivation ?'
                            : 'Désactiver le compte'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
