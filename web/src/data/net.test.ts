// Non-régression de la panne du 24/09/2026 : un serveur IGN qui accepte la
// connexion puis fait attendre (ou ne répond jamais) ne doit plus faire
// échouer la mesure.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRetry } from './net'

const FAST = { hedgeDelaysMs: [30, 30, 30], bodyTimeoutMs: 80, deadlineMs: 400, backoffMs: 1 }

/** Requête « bloquée » : ne résout jamais, ne rejette qu'à l'abandon. */
function stalled(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    )
  })
}

/** Réponse dont le corps démarre puis se fige (transfert interrompu). */
function stalledBody(init?: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1, 2]))
      init?.signal?.addEventListener('abort', () =>
        c.error(new DOMException('aborted', 'AbortError')),
      )
    },
  })
  return new Response(body, { status: 206 })
}

const ok = (bytes = [7, 8, 9]) => new Response(new Uint8Array(bytes), { status: 206 })

afterEach(() => vi.unstubAllGlobals())

function stubFetch(...impls: ((init?: RequestInit) => Promise<Response> | Response)[]) {
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const impl = impls[Math.min(f.mock.calls.length - 1, impls.length - 1)]
    return impl(init)
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('fetchRetry', () => {
  it('double une requête sans réponse (panne IGN du 24/09)', async () => {
    const f = stubFetch(stalled, stalled, () => ok())
    const r = await fetchRetry('https://x/copc', {}, FAST)
    expect(r.status).toBe(206)
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([7, 8, 9])
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('garde l’original en vie : une réponse LENTE gagne si le doublon est pire', async () => {
    const aborted: boolean[] = []
    const slow = (init?: RequestInit) =>
      new Promise<Response>((res, rej) => {
        const t = setTimeout(() => res(ok([1])), 60)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          aborted.push(true)
          rej(new DOMException('aborted', 'AbortError'))
        })
      })
    const f = stubFetch(slow, stalled)
    const r = await fetchRetry('https://x/copc', {}, { ...FAST, hedgeDelaysMs: [20, 1000] })
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1])
    expect(f).toHaveBeenCalledTimes(2) // doublon lancé à 20 ms, l'original a gagné à 60
    expect(aborted).toEqual([]) // le gagnant n'est pas annulé
  })

  it('annule les doublons perdants', async () => {
    let abortedFirst = false
    const first = (init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => (abortedFirst = true))
      return stalled(init)
    }
    stubFetch(first, () => ok())
    await fetchRetry('https://x/copc', {}, FAST)
    expect(abortedFirst).toBe(true)
  })

  it('re-tente un transfert figé en cours de corps', async () => {
    const f = stubFetch(stalledBody, () => ok())
    const r = await fetchRetry('https://x/copc', {}, FAST)
    expect(r.status).toBe(206)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('abandonne proprement après le dernier essai', async () => {
    const f = stubFetch(stalled)
    await expect(fetchRetry('https://x/copc', {}, FAST)).rejects.toThrow(/pas de réponse \(4 essais\)/)
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('échoue VITE sur un réseau coupé (pas d’attente des doublons)', async () => {
    const f = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const t0 = Date.now()
    await expect(
      fetchRetry('https://x/copc', {}, { ...FAST, hedgeDelaysMs: [5000, 5000] }),
    ).rejects.toThrow(/échec \(3 essais\)/)
    expect(Date.now() - t0).toBeLessThan(200)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('attend et re-tente sur 429 (quota IGN) sans consommer d’essai', async () => {
    const f = stubFetch(
      () => new Response('quota', { status: 429 }),
      () => new Response('quota', { status: 429 }),
      () => ok(),
    )
    const r = await fetchRetry('https://x/copc', {}, FAST)
    expect(r.status).toBe(206)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('re-tente un 503 transitoire', async () => {
    const f = stubFetch(() => new Response('', { status: 503 }), () => ok())
    expect((await fetchRetry('https://x/wfs', {}, FAST)).status).toBe(206)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('traverse une rafale de 504 (passerelle IGN, 24/09)', async () => {
    const gw = () => new Response('', { status: 504 })
    const f = stubFetch(gw, gw, gw, gw, () => ok())
    expect((await fetchRetry('https://x/copc', {}, FAST)).status).toBe(206)
    expect(f).toHaveBeenCalledTimes(5)
  })

  it('ne rend jamais un 5xx comme réponse : erreur après épuisement', async () => {
    stubFetch(() => new Response('', { status: 503 }))
    await expect(
      fetchRetry('https://x/wfs', {}, { ...FAST, hedgeDelaysMs: [], maxTransientRetries: 2 }),
    ).rejects.toThrow(/échec/)
  })

  it('rend un 404 tel quel, sans nouvel essai', async () => {
    const f = stubFetch(() => new Response('nope', { status: 404 }))
    const r = await fetchRetry('https://x/wfs', {}, FAST)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('transmet les en-têtes de la requête (Range)', async () => {
    const f = stubFetch(() => ok())
    await fetchRetry('https://x/copc', { headers: { Range: 'bytes=0-9' } }, FAST)
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Range).toBe('bytes=0-9')
  })
})
