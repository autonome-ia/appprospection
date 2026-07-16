import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Écran de connexion / inscription (email + mot de passe). */
export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { organization_name: orgName || 'Mon agence' } },
        })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>AppProspection</h1>
        <p className="auth-subtitle">
          {mode === 'login' ? 'Connexion à votre compte' : 'Créer un compte'}
        </p>

        {mode === 'signup' && (
          <input
            type="text"
            placeholder="Nom de l'agence"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? '...' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </button>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? 'Pas de compte ? En créer un' : 'Déjà un compte ? Se connecter'}
        </button>
      </form>
    </div>
  )
}
