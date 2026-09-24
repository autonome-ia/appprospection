// -----------------------------------------------------------------------------
// Requêtes GET vers les services publics (Géoplateforme IGN, RNB) : requêtes
// DOUBLÉES (« hedging ») + nouvel essai.
//
// Panne du 24/09/2026 : le serveur de téléchargement IGN (COPC LiDAR) a une
// latence à queue lourde — la plupart des requêtes Range répondent en < 1 s,
// mais ~30-40 % attendent 7, 17, 24… voire plus de 60 s avant le premier
// octet (connexion + TLS en ~70 ms : c'est le serveur qui fait attendre). Une
// requête NEUVE lancée pendant ce temps répond, elle, le plus souvent en < 1 s.
// Avec un seul essai de 20 s, UNE lecture lente sur la dizaine d'une maison
// faisait échouer toute la mesure (« mesure laser indisponible »).
// Parade : si les en-têtes tardent, on lance un DOUBLON sans abandonner
// l'original, et la première réponse gagne (les autres sont annulées). Une
// erreur réseau relance aussitôt ; 429 (quota) et 5xx attendent un backoff.
// Réservé aux GET idempotents. Module pur : testé par net.test.ts.
// -----------------------------------------------------------------------------

export interface RetryOptions {
  /** Délais (ms) avant chaque doublon, tant qu'aucune réponse n'est arrivée :
      [4000, 6000] = doublon à 4 s, puis un 3e à 10 s. Longueur + 1 = essais. */
  hedgeDelaysMs?: number[]
  /** Délai max de lecture du corps, une fois les en-têtes reçus. */
  bodyTimeoutMs?: number
  /** Délai max de la requête entière, tous essais confondus. */
  deadlineMs?: number
  /** Essais supplémentaires sur 429 (quota IGN), backoff exponentiel. */
  maxRateLimitRetries?: number
  /** Essais supplémentaires sur 502/503/504 (passerelle IGN), backoff exponentiel. */
  maxTransientRetries?: number
  /** Base du backoff (ms). */
  backoffMs?: number
}

const DEFAULTS: Required<RetryOptions> = {
  hedgeDelaysMs: [4_000, 6_000, 8_000],
  bodyTimeoutMs: 25_000,
  deadlineMs: 45_000,
  maxRateLimitRetries: 5,
  maxTransientRetries: 4,
  backoffMs: 500,
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** Statuts transitoires côté serveur : on re-tente. */
const TRANSIENT = new Set([502, 503, 504])

/**
 * GET doublé si lent, re-tenté sur erreur réseau, 429 et 5xx transitoires. Le
 * corps est lu ICI (un transfert figé est ainsi re-tenté aussi) : l'appelant
 * reçoit une Response déjà en mémoire, utilisable comme d'habitude (ok,
 * status, json(), arrayBuffer()). Les autres statuts (404, 400…) sont rendus
 * tels quels, sans nouvel essai.
 */
export function fetchRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const o = { ...DEFAULTS, ...options }
  const maxAttempts = o.hedgeDelaysMs.length + 1
  return new Promise<Response>((resolve, reject) => {
    const inFlight = new Set<AbortController>()
    let settled = false
    let launched = 0
    let rateLimited = 0
    let transient = 0
    let lastError: unknown = null
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (done: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(hedgeTimer)
      clearTimeout(deadline)
      for (const c of inFlight) c.abort()
      inFlight.clear()
      done()
    }
    const fail = (what: string) =>
      finish(() =>
        reject(new Error(`${what} (${launched} essais) : ${url.slice(0, 120)}`, { cause: lastError })),
      )
    const deadline = setTimeout(() => fail('pas de réponse'), o.deadlineMs)

    const scheduleHedge = () => {
      clearTimeout(hedgeTimer)
      const delay = o.hedgeDelaysMs[launched - 1]
      if (delay != null) hedgeTimer = setTimeout(() => void launch(), delay)
    }
    /** Un essai s'est terminé sans réponse utilisable : relancer ou abandonner. */
    const attemptEnded = () => {
      if (settled) return
      if (launched < maxAttempts) void launch()
      else if (inFlight.size === 0) fail('échec')
    }

    const launch = async (counted = true) => {
      if (settled) return
      if (counted) launched++
      const ctrl = new AbortController()
      inFlight.add(ctrl)
      if (counted) scheduleHedge()
      let bodyTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const r = await fetch(url, { ...init, signal: ctrl.signal })
        if (settled) return
        if (r.status === 429 && rateLimited < o.maxRateLimitRetries) {
          inFlight.delete(ctrl)
          void r.body?.cancel().catch(() => {})
          await sleep(o.backoffMs * 2 ** rateLimited++)
          if (!settled) void launch(false) // quota : ne consomme pas d'essai
          return
        }
        if (TRANSIENT.has(r.status)) {
          // Rafales de 504 observées le 24/09 : backoff exponentiel, et un
          // 5xx n'est jamais « gagnant » tant qu'un autre essai est en vol.
          inFlight.delete(ctrl)
          void r.body?.cancel().catch(() => {})
          lastError = new Error(`HTTP ${r.status}`)
          if (transient < o.maxTransientRetries) {
            await sleep(o.backoffMs * 2 ** transient++)
            if (!settled) void launch(false)
          } else attemptEnded()
          return
        }
        // Premières en-têtes : cet essai gagne, les doublons sont annulés.
        clearTimeout(hedgeTimer)
        for (const c of inFlight) if (c !== ctrl) c.abort()
        inFlight.clear()
        inFlight.add(ctrl)
        bodyTimer = setTimeout(() => ctrl.abort(), o.bodyTimeoutMs)
        const buf = await r.arrayBuffer()
        clearTimeout(bodyTimer)
        inFlight.delete(ctrl) // corps lu : le gagnant n'a plus rien à annuler
        const nullBody = r.status === 204 || r.status === 205 || r.status === 304
        finish(() =>
          resolve(
            new Response(nullBody ? null : buf, {
              status: r.status,
              statusText: r.statusText,
              headers: r.headers,
            }),
          ),
        )
      } catch (e) {
        clearTimeout(bodyTimer)
        // Doublon annulé par le gagnant (ou fin de partie) : rien à faire.
        if (settled || !inFlight.has(ctrl)) return
        inFlight.delete(ctrl)
        lastError = e
        attemptEnded()
      }
    }

    void launch()
  })
}
