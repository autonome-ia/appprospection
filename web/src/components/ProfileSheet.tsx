import { useState } from 'react'
import { Drawer } from 'vaul'
import { ChevronRight, LogOut, Users, X } from 'lucide-react'
import { useSession } from '../lib/session'
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme'
import { isSupervisorRole, roleLabel } from '../domain/types'
import { TeamSheet } from './TeamSheet'

/**
 * Sheet « Profil & réglages » (extraite de l'Accueil au chantier Équipe) :
 * la secrétaire n'a pas l'onglet Accueil mais doit pouvoir changer de thème
 * et se déconnecter — la même sheet s'ouvre depuis l'en-tête de son agenda.
 * Elle porte aussi l'entrée « Équipe » (manager + chef des ventes) et ferme
 * d'abord (pas d'empilement de drawers vaul sur iOS).
 */

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Auto' },
]

function initials(name: string | null | undefined, fallback: string): string {
  const src = name?.trim() || fallback
  const parts = src.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

export function ProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { profile, session, signOut } = useSession()
  const themeChoice = useThemePref()
  const [teamOpen, setTeamOpen] = useState(false)
  const name = profile?.full_name ?? session?.user.email ?? null

  return (
    <>
      {/* repositionInputs={false} : gabarit commun des sheets (bug iOS). */}
      <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer-content">
            <div className="drawer-grip" />
            <div className="drawer-header">
              <span className="drawer-title">Profil &amp; réglages</span>
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
              <div className="user-card">
                <span className="avatar">{initials(profile?.full_name, session?.user.email ?? '?')}</span>
                <div className="user-meta">
                  <span className="user-name">{name ?? 'Utilisateur'}</span>
                  <span className="user-role">
                    {roleLabel(profile?.role)}
                    {session?.user.email ? ` · ${session.user.email}` : ''}
                  </span>
                </div>
              </div>
              {/* Thème : préférence de l'appareil (localStorage), appliquée
                  à chaud — « Auto » suit le réglage du téléphone. */}
              <div className="theme-pick">
                <span className="eyebrow">Thème</span>
                <div className="seg">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`seg-btn ${themeChoice === t.value ? 'is-active' : ''}`}
                      onClick={() => setThemePref(t.value)}
                    >
                      {themeChoice === t.value && <span className="seg-ind" />}
                      <span className="seg-text">{t.label}</span>
                    </button>
                  ))}
                </div>
                <p className="theme-hint">Auto : suit le réglage du téléphone.</p>
              </div>
              {isSupervisorRole(profile?.role) && (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => {
                    onOpenChange(false)
                    setTeamOpen(true)
                  }}
                >
                  <Users size={18} strokeWidth={1.8} />
                  <span>Équipe</span>
                  <ChevronRight size={17} strokeWidth={1.8} className="row-chevron" />
                </button>
              )}
              {session && (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => {
                    onOpenChange(false)
                    void signOut()
                  }}
                >
                  <LogOut size={18} strokeWidth={1.8} />
                  <span>Se déconnecter</span>
                  <ChevronRight size={17} strokeWidth={1.8} className="row-chevron" />
                </button>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {profile && <TeamSheet open={teamOpen} onOpenChange={setTeamOpen} profile={profile} />}
    </>
  )
}
