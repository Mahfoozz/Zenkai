import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Dices, Info, Play, RefreshCw, SearchX, Star, X } from 'lucide-react'
import { GENRES } from '../lib/constants'
import { isTyping } from '../lib/keys'
import { useHistory, useList } from '../lib/library'
import { choose, openSurprise, SURPRISE_EVENT, watchHref } from '../lib/surprise'
import { cn, formatLabel, pickTitle, stripHtml, toScore10 } from '../lib/utils'
import { fetchPickDetails, fetchRandomPool, matches, type Length, type PickDetails, type PickFilters, type PickMedia } from '../services/surprise'
import { CustomSelect } from './CustomSelect'
import { ShimmerButton } from './ShimmerButton'
import { StarBorder } from './StarBorder'
import { Tabs } from './Tabs'

type Pool = 'list' | 'any'
type Stage =
  | { s: 'idle' }
  | { s: 'loading' }
  | { s: 'rolling'; reel: PickMedia[] }
  | { s: 'result'; pick: PickMedia }
  | { s: 'empty' }
  | { s: 'error'; msg: string }

const LENGTHS = [
  { value: '', label: 'Any length' },
  { value: 'movie', label: 'Movie' },
  { value: 'short', label: 'Short · up to 13 eps' },
  { value: 'standard', label: 'Standard · 14–26 eps' },
  { value: 'long', label: 'Long · 27+ eps' },
]
const GENRE_OPTS = [{ value: '', label: 'Any genre' }, ...GENRES.map((g) => ({ value: g.name, label: g.name }))]
const SCORES = [
  { value: '', label: 'Any score' },
  { value: '60', label: '6+ score' },
  { value: '70', label: '7+ score' },
  { value: '80', label: '8+ score' },
]
const NO_FILTERS: PickFilters = { length: 'any', genre: '', minScore: 0 }

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'

// filters stick for the session (module state), like the search modal's last query
const session: { pool: Pool; onHold: boolean; f: PickFilters } = { pool: 'list', onHold: false, f: NO_FILTERS }

/** List entries AniList confirms are released and match `f`. A missing details batch means no airing status, so those are left out. */
function listPool(items: { id: number }[], media: Map<number, PickMedia> | undefined, f: PickFilters): PickMedia[] {
  const out: PickMedia[] = []
  for (const i of items) {
    const m = media?.get(i.id)
    if (m?.status && m.status !== 'NOT_YET_RELEASED' && matches(m, f)) out.push(m)
  }
  return out
}

const cover = (m: PickMedia) => m.coverImage.extraLarge ?? m.coverImage.large ?? ''
const preload = (src: string) => {
  if (src) new Image().src = src
}
function shuffled<T>(a: T[]): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/** "Surprise me": a random pick from the plan-to-watch list (or anything popular). Mounted once in App; open with `openSurprise()` or R. */
export function SurpriseModal() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const list = useList()
  const history = useHistory()
  const reduce = useReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  const run = useRef(0)

  const [pool, setPoolState] = useState<Pool>(session.pool)
  const [onHold, setOnHoldState] = useState(session.onHold)
  const [f, setFState] = useState<PickFilters>(session.f)
  const [stage, setStage] = useState<Stage>({ s: 'idle' })
  const [details, setDetails] = useState<(PickDetails & { key: string }) | null>(null)

  const mine = useMemo(() => list.filter((i) => i.status === 'planning' || (onHold && i.status === 'paused')), [list, onHold])
  const key = mine.map((i) => i.id).join()
  const ready = details?.key === key
  const listCands = useMemo(() => listPool(mine, details?.media, f), [mine, details, f])
  const filtered = f.length !== 'any' || !!f.genre || !!f.minScore

  // changing what to pick from drops a request still in flight (it used the old filters) and clears a dead end, but keeps a pick on screen
  const settle = () => {
    run.current++
    setStage((st) => (st.s === 'loading' || st.s === 'empty' || st.s === 'error' ? { s: 'idle' } : st))
  }
  const setPool = (p: Pool) => {
    session.pool = p
    setPoolState(p)
    settle()
  }
  const setOnHold = (v: boolean) => {
    session.onHold = v
    setOnHoldState(v)
    settle()
  }
  const setF = (patch: Partial<PickFilters>) => {
    const next = { ...f, ...patch }
    session.f = next
    setFState(next)
    settle()
  }

  async function roll(over: { pool?: Pool; f?: PickFilters } = {}) {
    if (stage.s === 'loading' || stage.s === 'rolling') return
    const p = over.pool ?? pool
    const flt = over.f ?? f
    const id = ++run.current
    let cands: PickMedia[]
    try {
      if (p === 'list') {
        if (!ready) setStage({ s: 'loading' })
        const d = await fetchPickDetails(mine.map((i) => i.id))
        if (id === run.current) setDetails({ ...d, key }) // a retry that got through refreshes the count too
        cands = listPool(mine, d.media, flt)
        // titles without details are left out, so "nothing matches" would be misleading: offer a retry instead
        if (!cands.length && d.partial) throw new Error('Your list could not be loaded from AniList. Check your connection and try again.')
      } else {
        setStage({ s: 'loading' })
        const skip = new Set([...list.map((i) => i.id), ...history.map((h) => h.id)])
        cands = await fetchRandomPool(flt, (m) => !skip.has(m.id))
      }
    } catch (e) {
      if (id === run.current) setStage({ s: 'error', msg: e instanceof Error ? e.message : 'AniList could not be reached.' })
      return
    }
    if (id !== run.current) return
    const pick = choose(cands)
    if (!pick) return setStage({ s: 'empty' })
    preload(cover(pick))
    preload(pick.bannerImage ?? '')
    if (reduce || cands.length < 2) return setStage({ s: 'result', pick })
    const reel = [...shuffled(cands.filter((m) => m.id !== pick.id)).slice(0, 9), pick]
    reel.forEach((m) => preload(m.coverImage.large ?? ''))
    setStage({ s: 'rolling', reel })
  }
  const rollRef = useRef(roll)
  rollRef.current = roll
  const rerolled = useRef(false)

  /* ---- open: button event or R anywhere in the anime section ---- */
  useEffect(() => {
    const show = () => setOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || e.key.toLowerCase() !== 'r') return
      if (document.querySelector('[role="dialog"]')) return // another dialog (or this one: it rerolls itself)
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener(SURPRISE_EVENT, show)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(SURPRISE_EVENT, show)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // a fresh start each time; an empty plan-to-watch list goes straight to "Anything"
  useEffect(() => {
    if (!open) return
    run.current++
    setStage({ s: 'idle' })
    if (!mine.length && session.pool === 'list') setPoolState('any')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => setOpen(false), [pathname])

  // list entries only store Meta: fetch genres, synopsis and banners for them while the filters are set
  useEffect(() => {
    if (!open || !key) return
    let live = true
    fetchPickDetails(key.split(',').map(Number)).then((d) => live && setDetails({ ...d, key }))
    return () => {
      live = false
    }
  }, [open, key])

  /* ---- Esc / Back closes, Tab stays inside, focus goes back where it was ---- */
  useEffect(() => {
    if (!open) return
    const back = document.activeElement as HTMLElement | null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => focusFirst(box.current), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return // an open dropdown handled it
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === 'Tab' && box.current) {
        const els = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        const inside = box.current.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault()
          first.focus()
        }
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault()
        rollRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      back?.focus?.({ preventScroll: true })
    }
  }, [open])

  // the button that started a roll is gone once the pick lands: focus "Watch now", or Reroll again (D-pad users keep their place)
  useEffect(() => {
    if (stage.s !== 'result' && stage.s !== 'empty' && stage.s !== 'error') return
    const el = box.current
    if (!el || el.contains(document.activeElement)) return
    const again = rerolled.current && stage.s === 'result' ? el.querySelector<HTMLElement>('[data-reroll] button') : null
    rerolled.current = false
    if (again) again.focus({ preventScroll: true })
    else focusFirst(el)
  }, [stage])

  const pick = stage.s === 'result' ? stage.pick : null
  const w = pick ? watchHref(pick.id, pick.episodes) : null
  const banner = pick ? pick.bannerImage || cover(pick) : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby="surprise-title"
            className="relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:max-h-[88svh] sm:max-w-2xl sm:rounded-3xl"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 32 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* the pick's banner fades in behind the header */}
            <AnimatePresence>
              {banner && (
                <motion.div key={banner} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <img src={banner} alt="" className={cn('size-full object-cover opacity-45', !pick?.bannerImage && 'scale-125 blur-2xl')} />
                  <div className="absolute inset-0 bg-gradient-to-b from-card/40 via-card/80 to-card" />
                </motion.div>
              )}
            </AnimatePresence>

            <span aria-hidden className="relative mx-auto mt-2.5 block h-1 w-10 shrink-0 rounded-full bg-foreground/20 sm:hidden" />
            <div className="relative flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6">
              <div>
                <p className="eyebrow text-accent">Can’t decide?</p>
                <h2 id="surprise-title" className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  Surprise me
                </h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/10 transition hover:bg-foreground/20">
                <X className="size-4" />
              </button>
            </div>

            <div className="no-scrollbar relative flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
              {/* ---- filters ---- */}
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tabs<Pool>
                    value={pool}
                    onChange={setPool}
                    tabs={[
                      { id: 'list', label: 'Plan to watch', count: mine.length },
                      { id: 'any', label: 'Anything' },
                    ]}
                  />
                  {pool === 'list' && (
                    <button
                      type="button"
                      aria-pressed={onHold}
                      onClick={() => setOnHold(!onHold)}
                      className={cn(
                        'inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition active:scale-95',
                        onHold ? 'border-transparent bg-accent text-accent-fg' : 'border-border bg-card/60 text-muted hover:text-foreground',
                      )}
                    >
                      + On hold
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <CustomSelect label="Length" value={f.length === 'any' ? '' : f.length} onChange={(v) => setF({ length: (v || 'any') as Length })} options={LENGTHS} placeholder="Any length" />
                  <CustomSelect label="Genre" value={f.genre} onChange={(v) => setF({ genre: v })} options={GENRE_OPTS} placeholder="Any genre" />
                  <CustomSelect label="Minimum score" value={f.minScore ? String(f.minScore) : ''} onChange={(v) => setF({ minScore: Number(v) || 0 })} options={SCORES} placeholder="Any score" />
                </div>
                <p className="text-xs text-muted" aria-live="polite">
                  {pool === 'any'
                    ? 'Popular and top-rated anime that isn’t on your list yet.'
                    : !mine.length
                      ? 'Nothing here yet.'
                      : !ready
                        ? 'Checking your list on AniList…'
                        : `${listCands.length} of ${mine.length} match${details?.partial ? ' · some details could not load, so those titles were left out' : ''}`}
                </p>
              </div>

              {/* ---- stage ---- */}
              <div className="mt-5 min-h-[18rem]">
                {stage.s === 'idle' && (
                  <div className="flex flex-col items-center py-4 text-center">
                    <Fan
                      covers={
                        pool !== 'list'
                          ? []
                          : listCands.length
                            ? listCands.slice(0, 3).map((m) => ({ id: m.id, src: m.coverImage.large ?? cover(m), color: m.coverImage.color }))
                            : !ready || details?.partial
                              ? mine.slice(0, 3).map((i) => ({ id: i.id, src: i.image, color: i.color ?? null })) // stored covers until details arrive
                              : []
                      }
                    />
                    <p className="mt-6 max-w-sm text-sm text-muted">
                      {pool === 'list' ? 'One title from your plan-to-watch list, picked at random.' : 'One popular or highly rated title, picked at random.'}
                    </p>
                    <div className="mt-5" data-autofocus>
                      <StarBorder onClick={() => roll()}>
                        <Dices className="size-4" /> Pick for me
                      </StarBorder>
                    </div>
                  </div>
                )}

                {stage.s === 'loading' && (
                  <div className="flex flex-col items-center py-4 text-center" aria-live="polite">
                    <div className="grid aspect-[2/3] w-40 place-items-center rounded-2xl border border-border bg-card-2 sm:w-44">
                      <motion.span animate={reduce ? undefined : { rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}>
                        <Dices className="size-9 text-accent" />
                      </motion.span>
                    </div>
                    <p className="mt-4 text-sm text-muted">Shuffling…</p>
                  </div>
                )}

                {stage.s === 'rolling' && <Reel reel={stage.reel} onDone={(m) => setStage({ s: 'result', pick: m })} />}

                {pick && (
                  <>
                    <Result m={pick} reduce={!!reduce} />
                    {/* phone: the synopsis runs full width under the poster */}
                    {pick.description && <p className="mt-4 line-clamp-5 whitespace-pre-line text-sm leading-relaxed text-muted sm:hidden">{stripHtml(pick.description)}</p>}
                  </>
                )}

                {stage.s === 'empty' && (
                  <div className="flex flex-col items-center py-8 text-center">
                    <SearchX className="size-10 text-muted" />
                    <p className="mt-4 font-semibold">
                      {pool === 'list' ? (mine.length ? 'Nothing on your list matches' : 'Your plan-to-watch list is empty') : 'Nothing matches these filters'}
                    </p>
                    <p className="mt-1 max-w-sm text-sm text-muted">
                      {pool === 'list' ? 'Widen the filters, or pick from everything on AniList instead.' : 'Try another genre or length, or clear the filters.'}
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2.5" data-autofocus>
                      {pool === 'list' && (
                        <ShimmerButton
                          icon={<Dices className="size-4" />}
                          onClick={() => {
                            setPool('any')
                            roll({ pool: 'any' })
                          }}
                        >
                          Try Anything
                        </ShimmerButton>
                      )}
                      {filtered && (
                        <ShimmerButton
                          variant="ghost"
                          onClick={() => {
                            setF(NO_FILTERS)
                            roll({ f: NO_FILTERS })
                          }}
                        >
                          Clear filters
                        </ShimmerButton>
                      )}
                    </div>
                  </div>
                )}

                {stage.s === 'error' && (
                  <div className="flex flex-col items-center py-8 text-center">
                    <p className="font-semibold">Couldn’t shuffle</p>
                    <p className="mt-1 max-w-sm text-sm text-muted">{stage.msg}</p>
                    <div className="mt-5" data-autofocus>
                      <ShimmerButton icon={<RefreshCw className="size-4" />} onClick={() => roll()}>
                        Try again
                      </ShimmerButton>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {pick && w && (
              <div className="relative flex items-center gap-2 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-2.5 sm:px-6">
                <span data-autofocus className="min-w-0 flex-1 sm:flex-none">
                  <StarBorder to={w.href} color={pick.coverImage.color ?? undefined} className="block w-full whitespace-nowrap">
                    <Play className="size-4 fill-current" /> {w.resume ? `Continue · Ep ${w.resume}` : 'Watch now'}
                  </StarBorder>
                </span>
                <ShimmerButton variant="ghost" to={`/anime/${pick.id}`} icon={<Info className="size-4" />} className="px-3.5 sm:px-6">
                  <span className="sr-only sm:not-sr-only">Details</span>
                </ShimmerButton>
                <span data-reroll>
                  <ShimmerButton
                    variant="ghost"
                    onClick={() => {
                      rerolled.current = true
                      roll()
                    }}
                    icon={<RefreshCw className="size-4" />}
                    className="px-4 sm:px-6"
                  >
                    Reroll
                  </ShimmerButton>
                </span>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function focusFirst(el: HTMLElement | null) {
  const target = el?.querySelector<HTMLElement>(`[data-autofocus] :is(${FOCUSABLE})`) ?? el?.querySelector<HTMLElement>(FOCUSABLE)
  target?.focus({ preventScroll: true })
}

/** Up to three covers fanned out, as a hint of what is in the pool. */
function Fan({ covers }: { covers: { id: number; src: string; color: string | null }[] }) {
  if (!covers.length)
    return (
      <div className="grid aspect-[2/3] w-32 place-items-center rounded-2xl border border-dashed border-border bg-card-2/60">
        <Dices className="size-10 text-accent" />
      </div>
    )
  const mid = (covers.length - 1) / 2
  return (
    <div className="relative h-48 w-64" aria-hidden>
      {covers.map((m, i) => (
        <img
          key={m.id}
          src={m.src}
          alt=""
          className="absolute left-1/2 top-2 aspect-[2/3] w-28 rounded-2xl border border-border object-cover shadow-xl shadow-black/25"
          style={{ backgroundColor: m.color ?? undefined, transform: `translateX(calc(-50% + ${(i - mid) * 64}px)) rotate(${(i - mid) * 9}deg)`, zIndex: i === Math.round(mid) ? 2 : 1 }}
        />
      ))}
    </div>
  )
}

/** The shuffle: covers flick past and slow down, then the last one (the pick) lands. */
function Reel({ reel, onDone }: { reel: PickMedia[]; onDone: (m: PickMedia) => void }) {
  const [i, setI] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  const lastOne = i >= reel.length - 1
  const gap = 50 + i * i * 3.5 // ms: eases out like a slowing wheel

  useEffect(() => {
    const t = window.setTimeout(() => (lastOne ? done.current(reel[i]) : setI(i + 1)), lastOne ? 420 : gap)
    return () => window.clearTimeout(t)
  }, [i, lastOne, gap, reel])

  const m = reel[i]
  return (
    <div className="flex flex-col items-center py-4 text-center" aria-live="off">
      <motion.div
        className="relative aspect-[2/3] w-40 overflow-hidden rounded-2xl border border-border bg-card-2 shadow-2xl sm:w-44"
        animate={lastOne ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ backgroundColor: m.coverImage.color ?? undefined }}
      >
        <AnimatePresence initial={false}>
          <motion.img
            key={m.id}
            src={m.coverImage.large ?? cover(m)}
            alt=""
            className="absolute inset-0 size-full object-cover"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: Math.min(0.22, gap / 1000), ease: 'easeOut' }}
          />
        </AnimatePresence>
      </motion.div>
      <p className={cn('mt-4 line-clamp-1 max-w-xs text-sm transition-colors', lastOne ? 'font-semibold text-foreground' : 'text-muted')}>{pickTitle(m.title)}</p>
    </div>
  )
}

function Result({ m, reduce }: { m: PickMedia; reduce: boolean }) {
  const title = pickTitle(m.title)
  const synopsis = stripHtml(m.description)
  const fmt = formatLabel(m.format)
  const facts = [fmt !== '—' ? fmt : null, m.episodes && m.format !== 'MOVIE' ? `${m.episodes} ep` : null, m.duration ? `${m.duration} min` : null, m.seasonYear].filter(Boolean)
  return (
    <motion.div className="flex items-start gap-4 sm:gap-6" initial={{ opacity: 0, y: reduce ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
      <Link to={`/anime/${m.id}`} tabIndex={-1} className="shrink-0">
        <img
          src={cover(m)}
          alt={title}
          className="aspect-[2/3] w-28 rounded-2xl border border-border object-cover shadow-2xl shadow-black/30 sm:w-44"
          style={{ backgroundColor: m.coverImage.color ?? undefined }}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-3 font-display text-xl font-bold leading-tight tracking-tight sm:line-clamp-2 sm:text-3xl">{title}</h3>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {m.averageScore ? (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Star className="size-3.5 fill-current text-accent" />
              {toScore10(m.averageScore)}
            </span>
          ) : null}
          {facts.map((x, n) => (
            <span key={n} className="inline-flex items-center gap-2">
              {(n > 0 || m.averageScore) && <span aria-hidden>·</span>}
              {x}
            </span>
          ))}
        </p>
        {m.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.genres.slice(0, 5).map((g) => (
              <span key={g} className="rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-xs font-medium">
                {g}
              </span>
            ))}
          </div>
        )}
        {synopsis && <p className="mt-3 hidden whitespace-pre-line text-sm leading-relaxed text-muted sm:line-clamp-5">{synopsis}</p>}
      </div>
    </motion.div>
  )
}

/** Entry point: opens the picker. `compact` for tight headers. */
export function SurpriseButton({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <ShimmerButton variant="ghost" onClick={openSurprise} icon={<Dices className="size-4" />} className={cn(compact && 'px-4 py-2', className)}>
      Surprise me
    </ShimmerButton>
  )
}

/** Slim home-page strip (same shape as the profile strip) that opens the picker. */
export function SurpriseStrip() {
  const n = useList().filter((i) => i.status === 'planning').length
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6" aria-label="Surprise me">
      <button
        type="button"
        onClick={openSurprise}
        className="group flex w-full items-center gap-4 rounded-3xl border border-border bg-card/60 p-3.5 pr-4 text-left transition hover:bg-card active:scale-[0.99] sm:p-4 sm:pr-5"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/25">
          <Dices className="size-5 transition-transform duration-500 group-hover:rotate-180" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold sm:text-lg">Can’t decide? Surprise me</span>
          <span className="block truncate text-sm text-muted">{n ? `A random pick from the ${n === 1 ? 'title' : `${n} titles`} you plan to watch` : 'A random popular or top-rated pick'}</span>
        </span>
        <kbd className="hidden shrink-0 rounded-md border border-border bg-card-2 px-1.5 py-0.5 font-mono text-[0.72rem] font-semibold text-muted sm:inline-flex">R</kbd>
      </button>
    </section>
  )
}
