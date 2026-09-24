import { useState } from 'react'
import { Sheet } from './ui/Sheet'
import { ChevronRight, LogOut, Users } from 'lucide-react'
import { removeMyAvatar, uploadMyAvatar, useMedia } from '../data/media'
import { Avatar } from './ui/Avatar'
import { toast } from 'sonner'
import { useSession } from '../lib/session'
import { setThemePref, useThemePref, type ThemePref } from '../lib/theme'
import { isSupervisorRole, roleLabel } from '../domain/types'
import { TeamSheet } from './TeamSheet'
import { Segmented } from './ui/Segmented'

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

export function ProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { profile, session, signOut } = useSession()
  const media = useMedia()
  const hasPhoto = Boolean(profile && media.avatars[profile.id])
  const [photoBusy, setPhotoBusy] = useState(false)
  const changePhoto = async (file: File) => {
    if (!profile) return
    setPhotoBusy(true)
    try {
      await uploadMyAvatar(profile.id, file)
      toast.success('Photo mise à jour')
    } catch (e) {
      console.error('Photo :', e)
      toast.error('Photo non enregistrée : réessaie avec une autre image')
    } finally {
      setPhotoBusy(false)
    }
  }
  const dropPhoto = async () => {
    if (!profile) return
    setPhotoBusy(true)
    try {
      await removeMyAvatar(profile.id)
      toast('Photo retirée : tes initiales reprennent leur place')
    } catch (e) {
      console.error('Photo :', e)
      toast.error('Impossible de retirer la photo')
    } finally {
      setPhotoBusy(false)
    }
  }
  const themeChoice = useThemePref()
  const [teamOpen, setTeamOpen] = useState(false)
  const name = profile?.full_name ?? session?.user.email ?? null

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Profil & réglages"
      >
        <div className="user-card">
          {/* Sa photo (db/0025) : chacun la sienne — tap sur le rond ou sur
              « Changer la photo ». Recadrée et réduite sur le téléphone. */}
          <label className={`user-avatar ${media.supported && profile ? 'is-editable' : ''}`}>
            <Avatar id={profile?.id} name={profile?.full_name ?? session?.user.email} size={52} />
            {media.supported && profile && (
              <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={photoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void changePhoto(f)
                    }}
                  />
            )}
          </label>
          <div className="user-meta">
            <span className="user-name">{name ?? 'Utilisateur'}</span>
            <span className="user-role">
              {roleLabel(profile?.role)}
              {session?.user.email ? ` · ${session.user.email}` : ''}
            </span>
            {media.supported && profile && (
              <span className="user-photo-actions">
                <label className="text-btn">
                  {photoBusy ? 'Envoi…' : hasPhoto ? 'Changer la photo' : 'Ajouter une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={photoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void changePhoto(f)
                    }}
                  />
                </label>
                {hasPhoto && !photoBusy && (
                  <button type="button" className="text-btn" onClick={() => void dropPhoto()}>
                    Retirer
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        {/* Thème : préférence de l'appareil (localStorage), appliquée
            à chaud — « Auto » suit le réglage du téléphone. */}
        <div className="theme-pick">
          <span className="eyebrow">Thème</span>
          <Segmented options={THEMES} value={themeChoice} onChange={setThemePref} />
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
          // Action, pas navigation (audit design 24/09) : ni chevron, ni
          // air de ligne de menu — rouge et à part, en bas.
          <button
            type="button"
            className="row-action row-action-danger"
            onClick={() => {
              onOpenChange(false)
              void signOut()
            }}
          >
            <LogOut size={18} strokeWidth={1.8} />
            <span>Se déconnecter</span>
          </button>
        )}
      </Sheet>

      {profile && <TeamSheet open={teamOpen} onOpenChange={setTeamOpen} profile={profile} />}
    </>
  )
}
