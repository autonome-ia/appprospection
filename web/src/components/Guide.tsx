import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { BellRing, Box, CalendarCheck, Crosshair, GraduationCap, X } from 'lucide-react'
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

// Refonte v2 (chantier 27/07, plan validé par briac — docs/plan-guides-v2.md) :
// 4 guides courts qui suivent la boucle terrain (pose → relance → RDV → toit),
// UNE idée par étape, la capture montre LITTÉRALEMENT ce que la phrase dit.
// « ?v=2 » casse le cache navigateur des anciennes captures (mêmes noms).
const GUIDES: Guide[] = [
  {
    id: 'pose',
    title: 'Poser un point',
    icon: Crosshair,
    steps: [
      {
        img: '/guide/pose-1.webp?v=2',
        alt: 'Carte avec le bouton « + » pour poser un point',
        text: 'Tout part du bouton « + » en bas de la carte : touchez-le pour poser votre premier point.',
      },
      {
        img: '/guide/pose-2.webp?v=2',
        alt: 'Mode visée : réticule sur un toit et choix du statut',
        text: 'Amenez la maison sous le viseur, choisissez le statut, puis « Poser ici ».',
      },
      {
        img: '/guide/pose-3.webp?v=2',
        alt: 'Fiche du point : nom, téléphone et note renseignés',
        text: 'Après la pose, la fiche s’ouvre : notez le nom, le téléphone, un mot — toute l’équipe le voit en temps réel.',
      },
    ],
  },
  {
    id: 'relance',
    title: 'Relancer une porte',
    icon: BellRing,
    steps: [
      {
        img: '/guide/relance-1.webp?v=2',
        alt: 'Fiche « À revoir » avec la date de relance « Revoir le »',
        text: 'Sur un point « À revoir », datez la relance dans « Revoir le » — une semaine plus tard est proposée d’office.',
      },
      {
        img: '/guide/relance-2.webp?v=2',
        alt: 'Accueil : la section « À relancer » du jour',
        text: 'Le jour venu, la porte vous attend sur l’Accueil, dans « À relancer » — plus rien ne se perd.',
      },
    ],
  },
  {
    id: 'rdv',
    title: 'Prendre un RDV',
    icon: CalendarCheck,
    steps: [
      {
        img: '/guide/rdv-1.webp?v=2',
        alt: 'Formulaire de RDV pré-rempli depuis le point',
        text: 'Posez un point « RDV pris » : le formulaire s’ouvre tout seul, adresse, nom et téléphone déjà remplis.',
      },
      {
        img: '/guide/rdv-2.webp?v=2',
        alt: 'Agenda du mois : une couleur par commercial',
        text: 'L’agenda est partagé : une couleur par commercial — la chip « Mes RDV » n’affiche que les vôtres.',
      },
      {
        img: '/guide/rdv-3.webp?v=2',
        alt: 'Planning du jour : les issues du RDV en un tap',
        text: 'Le jour J, l’issue se donne en un tap depuis le planning du jour — « Vendu » repasse la maison en vert sur la carte.',
      },
    ],
  },
  {
    id: 'maison',
    title: 'Mesurer un toit',
    icon: Box,
    steps: [
      {
        img: '/guide/maison-1.webp?v=2',
        alt: 'Fiche maison : année, matériau et toit mesuré au laser',
        text: 'Touchez n’importe quelle maison, même sans point : sa fiche s’ouvre — année, matériau, et le toit déjà mesuré au laser.',
      },
      {
        img: '/guide/maison-2.webp?v=2',
        alt: 'Maquette 3D : un pan exclu du total au tap',
        text: 'Dépliez « Toiture mesurée » : la maquette 3D tourne au doigt, et un tap sur un pan l’ajoute ou le retire du total.',
      },
      {
        img: '/guide/maison-3.webp?v=2',
        alt: 'Rapport de toiture : chiffres et plan coté à partager',
        text: 'Le segment « Rapport » assemble surfaces et plan coté en une image : partagez-la, l’argumentaire est posé sur la table.',
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
