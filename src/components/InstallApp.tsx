import { Link } from 'react-router-dom'
import { MonitorDown, Share, SquarePlus } from 'lucide-react'
import { promptInstall, useInstall } from '../lib/pwa'
import { cn } from '../lib/utils'

/**
 * Install Zenkai from the browser. A button where the browser offers a prompt (Chrome, Edge, Samsung),
 * Share -> Add to Home Screen steps on iPhone / iPad, nothing once installed or where neither applies.
 */
export function InstallApp({ className }: { className?: string }) {
  const { canPrompt, installed, ios } = useInstall()
  if (installed) return null

  if (canPrompt)
    return (
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl border border-border bg-card/60 p-4 pr-5 backdrop-blur', className)}>
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-foreground/5">
          <MonitorDown className="size-5 text-accent" />
        </span>
        <span className="min-w-[12rem] flex-1">
          <span className="block font-semibold">Install the web app</span>
          <span className="block text-sm text-muted">Its own window and icon, opens straight to Zenkai.</span>
        </span>
        <button type="button" onClick={() => void promptInstall()} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-background/60 px-5 text-sm font-semibold transition hover:bg-foreground hover:text-background active:scale-95 sm:w-auto">
          Install app
        </button>
      </div>
    )

  if (ios)
    return (
      <div className={cn('rounded-3xl border border-border bg-card/60 p-4 pr-5 backdrop-blur', className)}>
        <p className="font-semibold">Add Zenkai to your Home Screen</p>
        <ol className="mt-2 space-y-1.5 text-sm text-muted">
          <li className="flex items-center gap-2">
            <span className="text-foreground">1.</span> Tap <Share className="size-4 text-foreground" aria-label="Share" /> Share in the browser bar
          </li>
          <li className="flex items-center gap-2">
            <span className="text-foreground">2.</span> Choose <SquarePlus className="size-4 text-foreground" aria-hidden /> <span className="font-semibold text-foreground">Add to Home Screen</span>
          </li>
        </ol>
      </div>
    )

  return null
}

/** Footer entry: the prompt where there is one, the /app page (with the iOS steps) on iPhone / iPad. */
export function InstallLink({ className }: { className?: string }) {
  const { canPrompt, installed, ios } = useInstall()
  if (installed || !(canPrompt || ios)) return null
  return canPrompt ? (
    <button type="button" onClick={() => void promptInstall()} className={className}>
      Install app
    </button>
  ) : (
    <Link to="/app" className={className}>
      Add to Home Screen
    </Link>
  )
}
