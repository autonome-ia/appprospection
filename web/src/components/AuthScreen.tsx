import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, MailCheck } from 'lucide-react'
import { motion, useAnimationControls } from 'motion/react'
import { EASE_OUT } from '../lib/motion'
import { supabase } from '../lib/supabase'

/**
 * Connexion / inscription par code d'invitation (chantier Équipe, étape 2).
 * L'inscription exige un code d'agence (db/0019 : handle_new_user refuse tout
 * signup sans code valide) : on vérifie le code via la RPC anonyme
 * `validate_invite` AVANT de créer le compte — Supabase ne renvoie qu'une
 * erreur générique quand le trigger rejette, l'utilisateur mérite mieux.
 * ⚠ Les sondes Playwright se connectent par getByPlaceholder('Email') /
 * ('Mot de passe') et le bouton « Se connecter » — ne pas renommer.
 */

type CodeCheck =
  | { state: 'idle' | 'checking' }
  | { state: 'ok'; org: string }
  | { state: 'bad'; message: string }

/** Messages Supabase traduits (les plus fréquents seulement). */
function frenchAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet email.'
  if (m.includes('password should be')) return 'Mot de passe : 6 caractères minimum.'
  if (m.includes('valid email')) return 'Adresse email invalide.'
  if (m.includes('not confirmed')) return 'Email non confirmé : vérifie ta boîte mail.'
  if (m.includes('database error'))
    return 'Le code d’invitation n’a pas été accepté : vérifie-le et réessaie.'
  return message
}

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState('')
  const [codeCheck, setCodeCheck] = useState<CodeCheck>({ state: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Carte : entrée en fondu montant, puis secousse courte à chaque erreur
  // (le « non » d'iOS sur un mauvais mot de passe — chantier design 24/09).
  const shake = useAnimationControls()
  useEffect(() => {
    void shake.start({ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT, delay: 0.05 } })
  }, [shake])
  useEffect(() => {
    if (!error) return
    void shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.32, ease: 'easeOut' } })
  }, [error, shake])
  // Compte créé mais email à confirmer (selon le réglage Supabase du projet).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  // Jeton anti-course : seule la réponse du DERNIER code saisi compte.
  const checkSeq = useRef(0)

  useEffect(() => {
    if (mode !== 'signup') return
    if (code.length !== 8) {
      setCodeCheck({ state: 'idle' })
      return
    }
    const seq = ++checkSeq.current
    setCodeCheck({ state: 'checking' })
    void (async () => {
      if (!supabase) return
      const { data, error } = await supabase.rpc('validate_invite', { invite_code: code })
      if (seq !== checkSeq.current) return
      if (error) {
        // Fonction absente = migration pas encore passée : inscription fermée.
        const closed = error.code === 'PGRST202' || error.message.includes('function')
        setCodeCheck({
          state: 'bad',
          message: closed
            ? 'L’inscription n’est pas encore ouverte : réessaie plus tard.'
            : 'Vérification impossible : réessaie.',
        })
        return
      }
      if (typeof data === 'string' && data.length > 0) setCodeCheck({ state: 'ok', org: data })
      else setCodeCheck({ state: 'bad', message: 'Code inconnu : vérifie auprès de ton manager.' })
    })()
  }, [code, mode])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        if (codeCheck.state !== 'ok') return
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { invite_code: code, full_name: fullName.trim() } },
        })
        if (error) throw error
        // Session absente = confirmation d'email exigée par le projet.
        if (!data.session) setPendingEmail(email)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? frenchAuthError(err.message) : 'Erreur inconnue')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next)
    setError(null)
    setPendingEmail(null)
  }

  return (
    <div className="auth-screen">
      <motion.div
        className="auth-brand"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1, transition: { duration: 0.35, ease: EASE_OUT } }}
      >
        <span className="auth-mark">
          AppProspection<span className="auth-mark-dot">.</span>
        </span>
        <span className="auth-tagline">Prospection porte-à-porte</span>
      </motion.div>

      {pendingEmail ? (
        <div className="auth-card">
          <MailCheck size={26} strokeWidth={1.8} className="auth-mail-icon" />
          <h1 className="auth-title">Compte créé</h1>
          <p className="auth-subtitle">
            Un email de confirmation a été envoyé à <strong>{pendingEmail}</strong>. Clique sur le
            lien qu’il contient, puis connecte-toi.
          </p>
          <button type="button" className="btn btn-primary auth-submit" onClick={() => switchMode('login')}>
            Se connecter
          </button>
        </div>
      ) : (
        <motion.form
          className="auth-card"
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 12 }}
          animate={shake}
        >
          <h1 className="auth-title">{mode === 'login' ? 'Connexion' : 'Rejoindre son agence'}</h1>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Avec le compte de ton agence.'
              : 'Avec le code d’invitation donné par ton manager.'}
          </p>

          {mode === 'signup' && (
            <>
              <p className="eyebrow field-label">Code d’invitation</p>
              <input
                className="field-input auth-code"
                type="text"
                placeholder="········"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                required
              />
              {codeCheck.state === 'checking' && <p className="auth-code-status">Vérification…</p>}
              {codeCheck.state === 'ok' && (
                <p className="auth-code-status is-ok">
                  <CheckCircle2 size={15} strokeWidth={2} />
                  Tu rejoins {codeCheck.org}
                </p>
              )}
              {codeCheck.state === 'bad' && (
                <p className="auth-code-status is-bad">{codeCheck.message}</p>
              )}

              <p className="eyebrow field-label">Prénom et nom</p>
              <input
                className="field-input"
                type="text"
                placeholder="Jean Dupont"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </>
          )}

          {/* Identifiants groupés dans UN bloc façon iOS (chantier design 24/09) :
              le label doublait le placeholder. Labels gardés pour les lecteurs
              d'écran. Placeholders « Email » / « Mot de passe » INTOUCHABLES
              (point d'entrée des sondes Playwright). */}
          <div className="field-group">
            <label className="sr-only" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="field-group-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <label className="sr-only" htmlFor="auth-password">
              Mot de passe
            </label>
            <input
              id="auth-password"
              className="field-group-input"
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={busy || (mode === 'signup' && codeCheck.state !== 'ok')}
          >
            {busy && <span className="btn-spinner" aria-hidden="true" />}
            {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>

          <button
            type="button"
            className="auth-switch"
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login' ? 'J’ai un code d’invitation : créer mon compte' : 'Déjà un compte ? Se connecter'}
          </button>
        </motion.form>
      )}
    </div>
  )
}
