import { useEffect, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import {
  BarChart3,
  BookUser,
  Box,
  CalendarCheck,
  GraduationCap,
  Home,
  Map,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from '../lib/session'

// -----------------------------------------------------------------------------
// Guide de l'app v3 (10/08, retours Alexis + briac) : UN GUIDE PAR ONGLET
// (+ le toit, le différenciateur), des étapes titrées, navigation au swipe.
// Doctrine v2 conservée : une phrase par étape, la capture montre
// LITTÉRALEMENT ce que la phrase dit (halo orange sur la cible).
// Les captures sortent de l'AGENCE DE DÉMO (tools/screenshots/seed-demo.mjs
// + shoot.mjs — données fictives, jamais la prod). « ?v=3 » casse le cache.
// Auto-ouverture du 1er guide à la PREMIÈRE connexion d'un compte de moins
// de 48 h (jamais pour les comptes existants, jamais sous Playwright).
// -----------------------------------------------------------------------------

interface GuideStep {
  img: string
  alt: string
  /** Titre court de l'étape (« Le viseur ») — sommaire mental du guide. */
  title: string
  text: string
}

interface Guide {
  id: string
  title: string
  icon: LucideIcon
  steps: GuideStep[]
}

const v3 = (name: string) => `/guide/${name}.webp?v=3`

const GUIDES: Guide[] = [
  {
    id: 'carte',
    title: 'La carte — prospecter',
    icon: Map,
    steps: [
      {
        img: v3('carte-1'),
        alt: 'La carte du quartier et le bouton « + »',
        title: 'Le viseur',
        text: 'Tout part du bouton « + » : amenez la maison sous la croix, la carte glisse sous votre doigt.',
      },
      {
        img: v3('carte-2'),
        alt: 'La grille des 6 statuts en mode visée',
        title: 'Les 6 statuts',
        text: 'Choisissez le statut dans la grille — du simple « Absent » au « RDV pris » — puis « Poser ici ».',
      },
      {
        img: v3('carte-3'),
        alt: 'Fiche du point : client, téléphone, note',
        title: 'La fiche du point',
        text: 'Après la pose, la fiche s’ouvre : nom, téléphone, une note — tout ce que vous saurez de cette porte.',
      },
      {
        img: v3('carte-4'),
        alt: 'Fiche maison : année, matériau, toit mesuré',
        title: 'La fiche maison',
        text: 'Tapez n’importe quelle maison, même sans point : année, matériau, et le toit déjà mesuré au laser.',
      },
      {
        img: v3('carte-5'),
        alt: 'La barre de filtres de la carte',
        title: 'Les filtres',
        text: 'Le bouton filtres trie vos portes par statut ou ancienneté — « À relancer » montre celles qui attendent.',
      },
      {
        img: v3('carte-6'),
        alt: 'Déplacement d’un point par appui long',
        title: 'Mal posé ?',
        text: 'Appui long sur un point, puis glissez-le jusqu’à la bonne maison.',
      },
    ],
  },
  {
    id: 'agenda',
    title: 'L’agenda — vos RDV',
    icon: CalendarCheck,
    steps: [
      {
        img: v3('agenda-1'),
        alt: 'La grille du mois : couleurs et pastilles',
        title: 'Le mois d’un coup d’œil',
        text: 'Une pilule par RDV : la couleur dit QUI, la pastille dit QUOI — bleu à venir, ambre à revoir, vert vendu.',
      },
      {
        img: v3('agenda-2'),
        alt: 'La légende-filtre par commercial',
        title: 'La légende-filtre',
        text: 'Tapez « ● Prénom » pour l’agenda d’un collègue, « Moi » pour le vôtre.',
      },
      {
        img: v3('agenda-3'),
        alt: 'Le planning du jour',
        title: 'Le planning du jour',
        text: 'Tapez un jour : les heures, les clients, Appeler et Itinéraire en un tap.',
      },
      {
        img: v3('agenda-4'),
        alt: 'Les issues du RDV : Vendu, En attente, Refus, Annulé',
        title: 'Solder un RDV',
        text: 'Le jour J, donnez l’issue : Vendu, En attente, Refus ou Annulé — la carte se met à jour toute seule.',
      },
      {
        img: v3('agenda-5'),
        alt: 'Replanifier un RDV annulé',
        title: 'Décaler, replanifier',
        text: 'Le client n’est plus dispo ? « Modifier » décale le RDV ; un annulé propose « Replanifier ».',
      },
      {
        img: v3('agenda-6'),
        alt: 'Une tâche d’agenda et son bouton « Fait »',
        title: 'Les tâches',
        text: '« + Tâche » note l’acompte à récupérer ; « Fait ✓ » la barre — en retard, elle vous rattrape sur l’Accueil.',
      },
    ],
  },
  {
    id: 'contacts',
    title: 'Vos contacts',
    icon: BookUser,
    steps: [
      {
        img: v3('contacts-1'),
        alt: 'La liste des contacts triée par échéance',
        title: 'Trié par urgence',
        text: 'L’onglet Contacts liste vos prospects : le prochain RDV ou la relance la plus proche d’abord.',
      },
      {
        img: v3('contacts-2'),
        alt: 'Le formulaire « Nouveau contact »',
        title: 'Le client qui appelle',
        text: 'Le « + » crée un contact à distance : adresse, statut, RDV — posé sur la carte comme si vous y étiez.',
      },
    ],
  },
  {
    id: 'accueil',
    title: 'L’accueil — votre journée',
    icon: Home,
    steps: [
      {
        img: v3('accueil-1'),
        alt: 'La carte « Aujourd’hui » et l’objectif',
        title: 'Aujourd’hui',
        text: 'Vos portes, vos RDV du jour, vos relances — et la barre d’objectif de la semaine.',
      },
      {
        img: v3('accueil-2'),
        alt: 'La section « À relancer »',
        title: 'À relancer',
        text: 'Les portes dont le jour est venu remontent ici : un tap ouvre la carte, l’icône appelle.',
      },
      {
        img: v3('accueil-3'),
        alt: 'Le popup du matin : RDV sans issue',
        title: 'Que s’est-il passé ?',
        text: 'Un RDV d’hier sans issue ? L’app vous le demande au premier café — 4 boutons, 5 secondes.',
      },
    ],
  },
  {
    id: 'stats',
    title: 'Les stats — votre semaine',
    icon: BarChart3,
    steps: [
      {
        img: v3('stats-1'),
        alt: 'Le tunnel de conversion',
        title: 'Le tunnel',
        text: 'Portes → RDV pris → effectués → ventes : vos taux, et le point de blocage marqué en rouge.',
      },
      {
        img: v3('stats-2'),
        alt: 'Naviguer entre les périodes',
        title: 'Naviguer',
        text: 'Jour, semaine, mois — les chevrons remontent le temps, « Aujourd’hui » vous ramène.',
      },
    ],
  },
  {
    id: 'toit',
    title: 'Mesurer un toit',
    icon: Box,
    steps: [
      {
        img: v3('toit-1'),
        alt: 'Les pans mesurés dessinés sur la photo aérienne',
        title: 'La mesure laser',
        text: 'Chaque pan du toit est mesuré au laser et dessiné sur la photo — les m² s’affichent pan par pan.',
      },
      {
        img: v3('toit-2'),
        alt: 'Maquette 3D : un pan exclu du total au tap',
        title: 'La 3D au doigt',
        text: 'Dépliez « Toiture mesurée » : la maquette tourne au doigt, un tap sur un pan l’ajoute ou le retire du total.',
      },
      {
        img: v3('toit-3'),
        alt: 'Le rapport de toiture : chiffres et plan coté',
        title: 'Le rapport client',
        text: 'Le segment « Rapport » assemble surfaces et plan coté en une image : partagez-la, l’argumentaire est posé.',
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

/** Sheet d'un tuto : titre d'étape + capture + phrase, navigation par le pied
    sticky ET au swipe sur la capture (retour briac 10/08). Gabarit vaul commun. */
function GuideSheet({ guide, onOpenChange }: { guide: Guide; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState(0)
  const s = guide.steps[step]
  const last = step === guide.steps.length - 1
  const touch = useRef<{ x: number; y: number } | null>(null)
  const next = () => (last ? onOpenChange(false) : setStep(step + 1))
  const prev = () => step > 0 && setStep(step - 1)
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
            {/* Swipe horizontal = étape précédente/suivante (le corps est en
                data-vaul-no-drag : le geste ne se dispute pas avec vaul). */}
            <div
              className="guide-frame"
              onTouchStart={(e) =>
                (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })
              }
              onTouchEnd={(e) => {
                const t = touch.current
                touch.current = null
                if (!t) return
                const dx = e.changedTouches[0].clientX - t.x
                const dy = e.changedTouches[0].clientY - t.y
                if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                  if (dx < 0 && !last) setStep(step + 1)
                  if (dx > 0) prev()
                }
              }}
            >
              <GuideImage key={s.img} src={s.img} alt={s.alt} icon={guide.icon} />
            </div>
            <p className="eyebrow guide-step-eyebrow">{s.title}</p>
            <p className="guide-step-text">{s.text}</p>

            <div className="drawer-footer guide-footer">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={step === 0}
                onClick={prev}
              >
                Précédent
              </button>
              <span className="guide-dots" aria-label={`Étape ${step + 1} sur ${guide.steps.length}`}>
                {guide.steps.map((_, i) => (
                  <span key={i} className={`guide-dot ${i === step ? 'is-active' : ''}`} />
                ))}
              </span>
              <button type="button" className="btn btn-primary" onClick={next}>
                {last ? 'Terminer' : 'Suivant'}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const AUTO_KEY = 'guide-auto'

/** Section « Guide » de l'Accueil : cartes horizontales, tap → tuto. */
export function GuideSection() {
  const { profile } = useSession()
  const [open, setOpen] = useState<Guide | null>(null)

  // Auto-ouverture du 1er guide (étape 5 du chantier Équipe, intégrée ici) :
  // compte de MOINS DE 48 H uniquement — un ancien compte est marqué « vu »
  // d'office (personne ne veut un tuto surgir après une mise à jour). Jamais
  // sous Playwright : les sondes/captures resteraient piégées dans la sheet.
  useEffect(() => {
    if (!profile || navigator.webdriver) return
    try {
      if (localStorage.getItem(AUTO_KEY)) return
      const created = profile.created_at ? Date.parse(profile.created_at) : NaN
      const fresh = Number.isFinite(created) && Date.now() - created < 48 * 3600_000
      localStorage.setItem(AUTO_KEY, fresh ? 'done' : 'old')
      if (fresh) setOpen(GUIDES[0])
    } catch {
      /* stockage indisponible : pas d'auto-ouverture */
    }
  }, [profile])

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
