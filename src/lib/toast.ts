import { useSyncExternalStore } from 'react'

export type ToastKind = 'success' | 'info' | 'error'
export interface ToastAction {
  label: string
  onClick: () => void
}
export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  action?: ToastAction
}

let items: ToastItem[] = []
let n = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export const dismissToast = (id: number) => {
  items = items.filter((t) => t.id !== id)
  emit()
}

/**
 * Show a small toast. The same message replaces its earlier copy, so rapid changes never stack up.
 * With an action it stays until the action is used or the toast is dismissed.
 */
export function toast(message: string, kind: ToastKind = 'success', action?: ToastAction) {
  const id = ++n
  items = [...items.filter((t) => t.message !== message), { id, message, kind, action }].slice(-3)
  emit()
  if (!action) window.setTimeout(() => dismissToast(id), kind === 'error' ? 4200 : 2600)
}

export const useToasts = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => items,
  )
