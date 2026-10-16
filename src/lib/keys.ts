import { useEffect, useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------- helpers */

/** True while the user is typing somewhere (shortcuts must stay out of the way). */
export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
}

export const isArrowKey = (k: string) => k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight'

/** Remote "Back" buttons: browser/Android key names, plus webOS (461) and Tizen (10009) key codes. */
export function isBackKey(e: KeyboardEvent): boolean {
  return e.key === 'GoBack' || e.key === 'BrowserBack' || e.key === 'XF86Back' || e.keyCode === 461 || e.keyCode === 10009
}

/* ---------------------------------------------------------------- TV mode */

const TV_KEY = 'zk:tv'
const TV_UA = /SmartTV|Smart-TV|SMART-TV|Tizen|Web0S|WebOS|NetCast|HbbTV|BRAVIA|VIDAA|Hisense|PhilipsTV|AFT[A-Z]|AndroidTV|Android TV|GoogleTV|Google TV|CrKey|Roku|AppleTV|Fire TV|FireTV/i

function detectTv(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('tv') // ?tv=1 / ?tv=0 forces it and is remembered
    if (q === '1' || q === '0') localStorage.setItem(TV_KEY, q)
    const saved = localStorage.getItem(TV_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch {
    /* storage blocked: fall through to detection */
  }
  return typeof navigator !== 'undefined' && TV_UA.test(navigator.userAgent)
}

let tv = typeof window === 'undefined' ? false : detectTv()
const subs = new Set<() => void>()

export const isTvMode = () => tv
export function setTvMode(on: boolean) {
  tv = on
  try {
    localStorage.setItem(TV_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f())
}
export const useTvMode = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => tv,
    () => false,
  )

/** Mirrors TV mode onto <html data-tv> so CSS can enlarge the UI and draw big focus rings. */
export function useApplyTvMode() {
  const on = useTvMode()
  useEffect(() => {
    document.documentElement.toggleAttribute('data-tv', on)
  }, [on])
}

/* ---------------------------------------------------------------- shortcuts help */

export const SHORTCUTS_EVENT = 'zk:shortcuts'
export const openShortcuts = () => window.dispatchEvent(new Event(SHORTCUTS_EVENT))

export type ShortcutGroup = { title: string; rows: [keys: string[], what: string][] }

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Everywhere',
    rows: [
      [['/'], 'Search'],
      [['Ctrl', 'K'], 'Search (⌘ K on Mac)'],
      [['?'], 'This list'],
      [['R'], 'Surprise me: pick something to watch (anime)'],
      [['1', '–', '4'], 'Pick a section on the opening page'],
    ],
  },
  {
    title: 'Anime player',
    rows: [
      [['Space', 'K'], 'Play / pause'],
      [['←', '→'], 'Seek 10 s (hold Shift for 30 s)'],
      [['J', 'L'], 'Seek 10 s back / forward'],
      [['↑', '↓'], 'Volume'],
      [['0', '–', '9'], 'Jump to 0% – 90%'],
      [['Home', 'End'], 'Start / end'],
      [[',', '.'], 'Step one frame (while paused)'],
      [['<', '>'], 'Slower / faster'],
      [['N', 'P'], 'Next / previous episode'],
      [['M'], 'Mute'],
      [['C'], 'Captions'],
      [['F'], 'Fullscreen'],
      [['I'], 'Picture in picture'],
      [['Tab'], 'Skip intro / outro'],
      [['Esc'], 'Close menu'],
    ],
  },
  {
    title: 'Manga reader',
    rows: [
      [['←', '→'], 'Previous / next page (flips in right-to-left)'],
      [['Space', 'PgDn'], 'Next page'],
      [['Shift', 'Space'], 'Previous page (PgUp works too)'],
      [['Home', 'End'], 'First / last page'],
      [['[', ']'], 'Previous / next chapter'],
      [['C', 'S'], 'Chapters / settings'],
      [['F'], 'Fullscreen'],
    ],
  },
  {
    title: 'Novel reader',
    rows: [
      [['←', '→'], 'Previous / next chapter'],
      [['[', ']'], 'Previous / next chapter'],
      [['Esc'], 'Close panel'],
    ],
  },
  {
    title: 'TV remote & D-pad',
    rows: [
      [['D-pad'], 'Move focus between buttons and cards'],
      [['OK / Enter'], 'Open or press'],
      [['Back'], 'Close a menu, then go back'],
      [['Play/Pause', '⏭', '⏮', '⏩', '⏪'], 'Media keys control the player'],
      [['↑'], 'In the player: show the controls'],
      [['←', '→'], 'In the player: seek, or move between controls when they are shown'],
    ],
  },
]
