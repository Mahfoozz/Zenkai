import { Component, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

/**
 * Catches a page that fails to load (most often its code chunk: offline and never opened before, or
 * removed by a new deploy) so the app shows a retry instead of going blank. Resets on navigation.
 */
export class PageLoadBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    return (
      <div className="px-4 pb-24 pt-32">
        <ErrorState
          message={offline ? 'You are offline, and this page is not saved on this device yet.' : 'This page could not load. Zenkai may have just updated.'}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }
}
