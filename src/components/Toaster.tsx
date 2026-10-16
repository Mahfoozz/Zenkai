import { AnimatePresence, motion } from 'framer-motion'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { dismissToast, useToasts, type ToastItem } from '../lib/toast'
import { cn } from '../lib/utils'

const ICON = { success: Check, info: Info, error: TriangleAlert }
const SHELL = 'pointer-events-auto relative flex max-w-[min(92vw,24rem)] items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card/90 py-2.5 pl-2.5 pr-4 text-left text-sm font-semibold text-foreground shadow-2xl shadow-black/40 backdrop-blur-xl'
const MOTION = {
  layout: true,
  initial: { opacity: 0, y: -22, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -14, scale: 0.94 },
  transition: { type: 'spring', stiffness: 380, damping: 26 },
} as const

function Badge({ t }: { t: ToastItem }) {
  const Icon = ICON[t.kind]
  return (
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', t.kind === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-accent text-accent-fg')}>
      <Icon className="size-4" strokeWidth={3} />
    </span>
  )
}

/** Mounted once in App. Polite live region; tap a toast to dismiss it. Toasts with an action stay until used or closed. */
export function Toaster() {
  const list = useToasts()
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-[120] flex flex-col items-center gap-2 px-4">
      <AnimatePresence mode="popLayout">
        {list.map((t) =>
          t.action ? (
            <motion.div key={t.id} {...MOTION} className={cn(SHELL, 'pr-2')}>
              <Badge t={t} />
              <span className="min-w-0">{t.message}</span>
              <button
                type="button"
                onClick={() => (dismissToast(t.id), t.action!.onClick())}
                className="ml-1 shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-bold text-accent-fg transition hover:brightness-110 active:scale-95"
              >
                {t.action.label}
              </button>
              <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition hover:text-foreground">
                <X className="size-4" />
              </button>
            </motion.div>
          ) : (
            <motion.button key={t.id} type="button" {...MOTION} onClick={() => dismissToast(t.id)} className={SHELL}>
              <Badge t={t} />
              <span className="min-w-0">{t.message}</span>
              <motion.span aria-hidden className={cn('absolute bottom-0 left-0 h-0.5 w-full origin-left', t.kind === 'error' ? 'bg-red-400' : 'bg-accent')} initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: t.kind === 'error' ? 4.2 : 2.6, ease: 'linear' }} />
            </motion.button>
          ),
        )}
      </AnimatePresence>
    </div>
  )
}
