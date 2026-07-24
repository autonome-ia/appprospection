import { Component, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

// Garde-fou anti-écran-blanc : une exception dans un écran (montage, rendu)
// démontait TOUTE l'app sans aucun message — l'onglet Agenda est resté blanc
// sur le terrain sans que personne ne sache pourquoi. Ici : message + retry,
// et l'erreur reste visible en console pour le diagnostic.
interface Props {
  children: ReactNode
}

interface State {
  crashed: boolean
}

export class ScreenBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Écran planté :', error)
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="screen">
          <div className="empty-state">
            <RotateCcw size={26} strokeWidth={1.5} />
            <p>Une erreur est survenue sur cet écran.</p>
            <button
              type="button"
              className="text-btn"
              onClick={() => this.setState({ crashed: false })}
            >
              Réessayer
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
