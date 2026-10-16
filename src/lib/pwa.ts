import { useSyncExternalStore } from 'react'
import { toast } from './toast'

/** Chrome / Edge / Samsung Internet hand this over when the site can be installed. Not in lib.dom yet. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallState {
  /** The browser offered an install prompt we can show from a button. */
  canPrompt: boolean
  /** Already running as the installed app. */
  installed: boolean
  /** iPhone / iPad: no prompt there, the user adds it from the Share sheet. */
  ios: boolean
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
// iPadOS reports itself as a Mac; the touch points give it away.
const IOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
// ponytail: the Android app doesn't identify itself; "; wv)" is the stock Android WebView marker, so treat any WebView as the app.
const WEBVIEW = /; wv\)/.test(ua)

const standalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

let deferred: InstallPromptEvent | null = null
let state: InstallState = { canPrompt: false, installed: standalone(), ios: IOS }
const subs = new Set<() => void>()
const set = (next: Partial<InstallState>) => {
  state = { ...state, ...next }
  subs.forEach((f) => f())
}

export const useInstall = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => state,
  )

/** Shows the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null // a prompt event can only be used once
  set({ canPrompt: false })
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome === 'accepted'
}

/** Call once at start-up: listens for install offers and registers the service worker (production only). */
export function initPwa() {
  if (typeof window === 'undefined' || WEBVIEW) return

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // our own "Install app" button replaces the mini-infobar
    deferred = e as InstallPromptEvent
    set({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ canPrompt: false, installed: true })
  })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => set({ installed: standalone() }))

  if (import.meta.env.PROD && 'serviceWorker' in navigator) void registerWorker()
}

async function registerWorker() {
  if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }))
  const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null)
  if (!reg) return

  // Reload only when this tab asked for it, and only once. The very first install also fires
  // controllerchange (clients.claim), which must not reload anything.
  let asked = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!asked) return
    asked = false
    window.location.reload()
  })

  const offer = () =>
    toast('New version available', 'info', {
      label: 'Reload',
      onClick: () => {
        asked = true
        // Another tab may have activated it already; then a plain reload picks it up.
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        else window.location.reload()
      },
    })

  // Only an update counts: with no controller this is the first install, nothing to reload into.
  // register() waits for window load, so the update check that began at navigation is often
  // already installing. updatefound does not replay; watch that worker directly.
  const watch = (w: ServiceWorker | null) => {
    if (!w) return
    const installed = () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) offer()
    }
    w.addEventListener('statechange', installed)
    installed()
  }
  watch(reg.waiting)
  watch(reg.installing)
  reg.addEventListener('updatefound', () => watch(reg.installing))

  // The SPA rarely does a full navigation, so also look for a new deploy when the tab comes back (at most every 30 min).
  let checked = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - checked < 30 * 60e3) return
    checked = Date.now()
    reg.update().catch(() => {})
  })
}
