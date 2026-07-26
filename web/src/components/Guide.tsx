import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { Box, CalendarCheck, Crosshair, GraduationCap, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// -----------------------------------------------------------------------------
// Guide de l'app (Accueil, refonte 26/07) : tutos pas-à-pas avec captures
// d'écran réelles — l'onboarding des commerciaux de l'équipe. Les images
// vivent dans web/public/guide/ (WebP compressé, chargées à la demande, hors
// precache PWA) ; tant qu'une capture manque, un placeholder DA s'affiche.
// Captures attendues : guide/<id>-<n° d'étape>.webp (voir GUIDES ci-dessous).
// -----------------------------------------------------------------------------

interface GuideStep {
  img: string
  alt: string
  text: string
}

interface Guide {
  id: string
  title: string
  icon: LucideIcon
  steps: GuideStep[]
}

const GUIDES: Guide[] = [
  {
    id: 'pose',
    title: 'Poser un point',
    icon: Crosshair,
    steps: [
      {
        img: '/guide/pose-1.webp',
        alt: 'Carte en mode visée avec le réticule au centre',
        text: 'Sur la carte, appuyez sur « + » : un viseur apparaît au centre. Déplacez la carte pour placer la maison sous le viseur (zoomez au niveau rue).',
      },
      {
        img: '/guide/pose-2.webp',
        alt: 'Choix du statut avant de poser le point',
        text: 'Choisissez le statut de la visite — Absent, À revoir, Refus, Hors cible, RDV pris ou Vendu — puis validez avec « Poser ».',
      },
      {
        img: '/guide/pose-3.webp',
        alt: 'Fiche du point ouverte après la pose',
        text: 'La fiche s’ouvre : nom du client, téléphone, note… Sur « À revoir », datez la relance — elle reviendra sur l’Accueil et dans l’agenda le jour venu.',
      },
      {
        img: '/guide/pose-4.webp',
        alt: 'Déplacement d’un point par appui long',
        text: 'Point mal placé ? Appui long dessus, puis glissez-le sur la bonne maison : adresse, fiche maison et mesure du toit se recalculent automatiquement.',
      },
    ],
  },
  {
    id: 'rdv',
    title: 'Prendre un RDV et le solder',
    icon: CalendarCheck,
    steps: [
      {
        img: '/guide/rdv-1.webp',
        alt: 'Formulaire de prise de rendez-vous',
        text: 'Posez un point « RDV pris » (ou « + RDV » depuis une fiche) : date, créneau à la demi-heure, client, adresse auto-complétée.',
      },
      {
        img: '/guide/rdv-2.webp',
        alt: 'Agenda : grille du mois avec les RDV de l’équipe',
        text: 'Le RDV rejoint l’agenda partagé : la grille du mois montre les RDV de toute l’équipe (une couleur par commercial). La chip « Mes RDV » filtre les vôtres.',
      },
      {
        img: '/guide/rdv-3.webp',
        alt: 'Planning d’un jour avec les issues du RDV',
        text: 'Tapez un jour pour ouvrir son planning. Le jour J, marquez l’issue en un tap : Vendu, Effectué, Manqué ou Annulé — c’est ce qui alimente les stats.',
      },
      {
        img: '/guide/rdv-4.webp',
        alt: 'Maison passée en vendu sur la carte',
        text: '« Vendu » rebascule automatiquement la maison en vert sur la carte — le chantier devient un point d’appui pour prospecter autour.',
      },
    ],
  },
  {
    id: 'maison',
    title: 'La fiche maison & le toit 3D',
    icon: Box,
    steps: [
      {
        img: '/guide/maison-1.webp',
        alt: 'Fiche maison avec les badges (année, matériau, DPE)',
        text: 'Tapez une maison sur la carte (même sans point) : adresse, année de construction, matériau du toit, DPE — et la mesure laser du toit se lance toute seule.',
      },
      {
        img: '/guide/maison-2.webp',
        alt: 'Pans du toit dessinés sur la photo aérienne',
        text: 'Les pans mesurés se dessinent sur la photo avec leurs surfaces ; le badge affiche les m² de LA maison (mesure laser IGN, fiable à quelques %).',
      },
      {
        img: '/guide/maison-3.webp',
        alt: 'Maquette 3D du toit manipulable au doigt',
        text: '« Voir le toit en 3D » : la maquette se manipule au doigt. Touchez un pan pour l’inclure ou l’exclure du total Σ — ajustez la surface retenue devant le client.',
      },
      {
        img: '/guide/maison-4.webp',
        alt: 'Rapport client avec plan coté et surfaces',
        text: 'Générez le rapport client : chiffres clés + plan coté, partageable en image ou imprimable — l’argumentaire posé sur la table du client.',
      },
    ],
  },
]

/** Image de tuto avec repli DA : tant que la capture n'est pas déposée dans
    public/guide/, on montre un placeholder au lieu d'une icône d'image cassée. */
function GuideImage({
  src,
  alt,
  icon: Icon,
  cover,
}: {
  src: string
  alt: string
  icon: LucideIcon
  cover?: boolean
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) {
    return (
      <span className={cover ? 'guide-ph is-cover' : 'guide-ph'}>
        <Icon size={cover ? 22 : 30} strokeWidth={1.5} />
        {!cover && <span className="guide-ph-note">Capture à venir</span>}
      </span>
    )
  }
  return (
    <img
      className={cover ? 'guide-img is-cover' : 'guide-img'}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/** Sheet d'un tuto : une capture + un texte par étape, navigation par le pied
    sticky. Gabarit vaul commun obligatoire (repositionInputs, no-drag). */
function GuideSheet({ guide, onOpenChange }: { guide: Guide; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState(0)
  const s = guide.steps[step]
  const last = step === guide.steps.length - 1
  return (
    <Drawer.Root open onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />

          <div className="drawer-header">
            <span className="drawer-title">{guide.title}</span>
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
            <div className="guide-frame">
              <GuideImage key={s.img} src={s.img} alt={s.alt} icon={guide.icon} />
            </div>
            <p className="guide-step-text">{s.text}</p>

            <div className="drawer-footer guide-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                Précédent
              </button>
              <span className="guide-dots" aria-label={`Étape ${step + 1} sur ${guide.steps.length}`}>
                {guide.steps.map((_, i) => (
                  <span key={i} className={`guide-dot ${i === step ? 'is-active' : ''}`} />
                ))}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => (last ? onOpenChange(false) : setStep(step + 1))}
              >
                {last ? 'Terminer' : 'Suivant'}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** Section « Guide » de l'Accueil : cartes horizontales, tap → tuto. */
export function GuideSection() {
  const [open, setOpen] = useState<Guide | null>(null)
  return (
    <section className="home-section">
      <p className="eyebrow section-title">
        <GraduationCap size={12} strokeWidth={2} /> Guide de l’app
      </p>
      {/* Axe verrouillé (convention défilement horizontal). */}
      <div className="guide-scroll">
        {GUIDES.map((g) => (
          <button key={g.id} type="button" className="guide-card" onClick={() => setOpen(g)}>
            <span className="guide-cover">
              <GuideImage cover src={g.steps[0].img} alt={g.title} icon={g.icon} />
            </span>
            <span className="guide-card-title">{g.title}</span>
          </button>
        ))}
      </div>
      {open && <GuideSheet guide={open} onOpenChange={(o) => !o && setOpen(null)} />}
    </section>
  )
}
