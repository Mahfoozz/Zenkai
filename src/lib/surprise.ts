import { getHistory, getPrefs } from './library'
import { lastEpisode } from './progress'

/** "Surprise me": any button can open the picker (it lives once in App, like the shortcuts list). */
export const SURPRISE_EVENT = 'zk:surprise'
export const openSurprise = () => window.dispatchEvent(new Event(SURPRISE_EVENT))

/* ---------- no repeats: the last few picks of this session are skipped while there is anything else ---------- */
const RECENT = 6
const recent: number[] = []

export function choose<T extends { id: number }>(pool: T[]): T | null {
  if (!pool.length) return null
  const fresh = pool.filter((m) => !recent.includes(m.id))
  const from = fresh.length ? fresh : pool.length > 1 ? pool.filter((m) => m.id !== recent[recent.length - 1]) : pool
  const pick = from[Math.floor(Math.random() * from.length)]
  recent.splice(0, recent.length, ...[...recent.filter((id) => id !== pick.id), pick.id].slice(-RECENT))
  return pick
}

/** Resume where this title was left (else episode 1), on the server / audio it, or anything, last used. */
export function watchHref(id: number, episodes: number | null): { href: string; resume: number } {
  const resume = lastEpisode(id)
  const ep = Math.max(1, episodes ? Math.min(resume || 1, episodes) : resume || 1)
  const p = { ...getPrefs(), ...getHistory(id) }
  return { href: `/watch/${id}?ep=${ep}${p.server ? `&server=${p.server}` : ''}${p.audio ? `&audio=${p.audio}` : ''}`, resume: resume ? ep : 0 }
}
