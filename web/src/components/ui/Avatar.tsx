import { useState } from 'react'
import { useMedia } from '../../data/media'
import { colorForCommercial } from '../../domain/colors'

/** « Julien Le Gall » → « JL » ; un email → la partie avant @. */
export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const base = (name ?? '').trim() || fallback
  const clean = base.includes('@') ? base.split('@')[0].replace(/[._-]+/g, ' ') : base
  const parts = clean.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * Rond d'un membre (chantier design 24/09) : sa PHOTO si elle existe, sinon
 * ses initiales sur SA couleur d'agenda (couleur = commercial). Même rendu
 * partout : Accueil, profil, Équipe, Stats.
 */
export function Avatar({
  id,
  name,
  color,
  size = 44,
  className = '',
}: {
  id: string | null | undefined
  name: string | null | undefined
  color?: string | null
  size?: number
  className?: string
}) {
  const { avatars } = useMedia()
  const url = id ? avatars[id] : null
  const [broken, setBroken] = useState<string | null>(null)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) }
  if (url && broken !== url) {
    return (
      <img
        className={`avatar avatar-photo ${className}`}
        src={url}
        alt=""
        style={style}
        onError={() => setBroken(url)}
      />
    )
  }
  return (
    <span
      className={`avatar ${className}`}
      style={{
        ...style,
        background: id ? colorForCommercial(id, color ?? null) : undefined,
        color: '#fff',
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

/** « Mister Toiture : Brest » → « MT » (mots porteurs, sans ponctuation). */
function monogramOf(name: string | null | undefined): string {
  const words = (name ?? '').split(/[\s:·,-]+/).filter((w) => /^[A-Za-zÀ-ÿ0-9]/.test(w))
  return ((words[0]?.[0] ?? 'A') + (words[1]?.[0] ?? '')).toUpperCase()
}

/** Logo de l'agence (vue Équipe des Stats, écran Équipe) : l'image posée par
    le manager, sinon un MONOGRAMME façon icône d'app (initiales de l'agence
    en blanc sur carré encre) — jamais d'emplacement vide ou « cassé ». */
export function OrgLogo({ size = 56, className = '' }: { size?: number; className?: string }) {
  const { org } = useMedia()
  const [broken, setBroken] = useState<string | null>(null)
  const url = org?.logo_url
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (url && broken !== url) {
    return (
      <img
        className={`org-logo org-logo-img ${className}`}
        src={url}
        alt={org?.name ?? ''}
        style={style}
        onError={() => setBroken(url)}
      />
    )
  }
  return (
    <span
      className={`org-logo ${className}`}
      style={{ ...style, fontSize: Math.round(size * 0.36) }}
      aria-label={org?.name ?? 'Agence'}
    >
      {monogramOf(org?.name)}
    </span>
  )
}
