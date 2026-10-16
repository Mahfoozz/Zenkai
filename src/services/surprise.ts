import type { AniCover, AniTitle } from '../types/anime'
import { gql } from './anilist'

/** Just enough of a title to filter it and show it on the "Surprise me" card. */
export interface PickMedia {
  id: number
  title: AniTitle
  coverImage: AniCover
  bannerImage: string | null
  description: string | null
  genres: string[]
  averageScore: number | null
  episodes: number | null
  duration: number | null
  format: string | null
  status: string | null
  seasonYear: number | null
}

export type Length = 'any' | 'movie' | 'short' | 'standard' | 'long'
export interface PickFilters {
  length: Length
  /** '' = any genre */
  genre: string
  /** 0 = any, else the lowest AniList score (0–100) */
  minScore: number
}

const FIELDS = /* GraphQL */ `
  id
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  description(asHtml: false)
  genres
  averageScore
  episodes
  duration
  format
  status
  seasonYear
`

/* ---------- list entries: the list only keeps Meta, so genres / synopsis / banner come from here ---------- */
const DETAILS_QUERY = /* GraphQL */ `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) { ${FIELDS} }
    }
  }
`
const known = new Map<number, PickMedia>()
let queue: Promise<unknown> = Promise.resolve()

export interface PickDetails {
  media: Map<number, PickMedia>
  /** a batch failed (rate limit, offline): those ids are absent and must not be treated as released */
  partial: boolean
}

/** Details for many ids, 50 per request and remembered for the session. Calls queue up so nothing is fetched twice. */
export function fetchPickDetails(ids: number[]): Promise<PickDetails> {
  const run = queue.then(() => loadDetails(ids))
  queue = run.catch(() => undefined)
  return run
}

async function loadDetails(ids: number[]): Promise<PickDetails> {
  const missing = [...new Set(ids)].filter((id) => !known.has(id))
  let partial = false
  // one batch at a time: AniList rate-limits bursts
  for (let i = 0; i < missing.length; i += 50) {
    try {
      const data = await gql<{ Page: { media: PickMedia[] } }>(DETAILS_QUERY, { ids: missing.slice(i, i + 50) })
      for (const m of data.Page.media) known.set(m.id, m)
    } catch {
      partial = true
    }
  }
  const media = new Map<number, PickMedia>()
  for (const id of ids) {
    const m = known.get(id)
    if (m) media.set(id, m)
  }
  return { media, partial }
}

/* ---------- filters (same rules locally and as AniList variables) ---------- */
const SERIES_ONLY = ['MOVIE', 'MUSIC']

/** Episode bounds per length; `lt`/`gt` are exclusive, as on AniList. */
const BOUNDS: Record<Exclude<Length, 'any' | 'movie'>, { gt?: number; lt?: number }> = {
  short: { lt: 14 },
  standard: { gt: 13, lt: 27 },
  long: { gt: 26 },
}

export function matches(m: Pick<PickMedia, 'format' | 'episodes' | 'averageScore' | 'genres'>, f: PickFilters): boolean {
  if (f.minScore && (m.averageScore ?? 0) < f.minScore) return false
  if (f.genre && !m.genres.includes(f.genre)) return false
  if (f.length === 'any') return m.format !== 'MUSIC'
  if (f.length === 'movie') return m.format === 'MOVIE'
  if (!m.format || SERIES_ONLY.includes(m.format) || !m.episodes) return false // still airing with no total: only "Any"
  const b = BOUNDS[f.length]
  return (b.gt === undefined || m.episodes > b.gt) && (b.lt === undefined || m.episodes < b.lt)
}

function filterVars(f: PickFilters): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  if (f.length === 'movie') v.formatIn = ['MOVIE']
  else if (f.length === 'any') v.formatNotIn = ['MUSIC']
  else {
    v.formatNotIn = SERIES_ONLY
    const b = BOUNDS[f.length]
    if (b.gt !== undefined) v.epMin = b.gt
    if (b.lt !== undefined) v.epMax = b.lt
  }
  if (f.genre) v.genre = f.genre
  if (f.minScore) v.score = f.minScore - 1 // averageScore_greater compares the unrounded score, so `matches` re-checks
  return v
}

/* ---------- "Anything": a random page of popular / top-rated titles ---------- */
const RANDOM_QUERY = /* GraphQL */ `
  query ($page: Int, $sort: [MediaSort], $genre: String, $formatIn: [MediaFormat], $formatNotIn: [MediaFormat], $epMin: Int, $epMax: Int, $score: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { lastPage }
      media(type: ANIME, isAdult: false, sort: $sort, status_not: NOT_YET_RELEASED, popularity_greater: 2000, genre: $genre, format_in: $formatIn, format_not_in: $formatNotIn, episodes_greater: $epMin, episodes_lesser: $epMax, averageScore_greater: $score) { ${FIELDS} }
    }
  }
`
/** Only the best-known 500 per sort: popular or highly rated, never obscure. */
const MAX_PAGE = 10
const lastPages = new Map<string, number>()

type RandomRes = { Page: { pageInfo: { lastPage: number }; media: PickMedia[] } }

/** Titles from a random page that pass `keep` (e.g. not already on the list). Empty when nothing matches at all. */
export async function fetchRandomPool(f: PickFilters, keep: (m: PickMedia) => boolean): Promise<PickMedia[]> {
  const sort = [Math.random() < 0.5 ? 'POPULARITY_DESC' : 'SCORE_DESC']
  const base = { ...filterVars(f), sort }
  const key = JSON.stringify(base)
  const tried = new Set<number>()
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = Math.min(lastPages.get(key) ?? MAX_PAGE, MAX_PAGE)
    const open = Array.from({ length: last }, (_, i) => i + 1).filter((p) => !tried.has(p))
    if (!open.length) break
    const page = open[Math.floor(Math.random() * open.length)]
    tried.add(page)
    let data = await gql<RandomRes>(RANDOM_QUERY, { ...base, page })
    // past the end: AniList's pageInfo is only right from a page that has results, so ask page 1
    if (!data.Page.media.length && page > 1) {
      tried.add(1)
      data = await gql<RandomRes>(RANDOM_QUERY, { ...base, page: 1 })
    }
    if (!data.Page.media.length) return []
    lastPages.set(key, data.Page.pageInfo.lastPage)
    const fresh = data.Page.media.filter((m) => keep(m) && matches(m, f))
    if (fresh.length) return fresh
  }
  return []
}
