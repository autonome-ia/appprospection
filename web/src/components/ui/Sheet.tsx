import type { ReactNode } from 'react'
import { Drawer } from 'vaul'
import { X } from 'lucide-react'

/**
 * Bottom sheet commune (chantier design 24/09) — remplace les 9 squelettes
 * vaul recopiés à la main. Elle VERROUILLE les correctifs iOS (chantier
 * scroll sheets, 25/07 — ne jamais les défaire) :
 *  - repositionInputs={false} : au focus d'un champ, vaul posait des styles
 *    height/bottom calculés sur visualViewport, faux en PWA iOS (sheet hors
 *    écran au clavier) ; le clavier se superpose, iOS fait défiler le champ ;
 *  - data-vaul-no-drag sur le corps : le geste vertical DANS le contenu fait
 *    défiler au lieu de tirer la sheet (fermer = poignée / en-tête / croix) ;
 *  - flex-shrink:0 des blocs fixes et recollage au blur : côté CSS/main.tsx.
 * Classes .drawer-* inchangées (styles, sondes Playwright).
 *
 * `modal={false}` : la carte reste manipulable derrière (fiches point et
 * maison) — pas de voile. `title` : texte (→ .drawer-title) ou en-tête
 * composé (.sheet-head). `meta` : ligne sous l'en-tête, hors défilement.
 * Le pied (.drawer-footer) se place en DERNIER enfant : il colle en bas du
 * corps défilant.
 */
export function Sheet({
  open,
  onOpenChange,
  modal = true,
  title,
  meta,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  modal?: boolean
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={modal} repositionInputs={false}>
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="drawer-overlay" />}
        <Drawer.Content className="drawer-content">
          <div className="drawer-grip" />
          <div className="drawer-header">
            {typeof title === 'string' ? <span className="drawer-title">{title}</span> : title}
            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
          {meta}
          <div className="drawer-body" data-vaul-no-drag>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
