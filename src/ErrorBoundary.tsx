import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// A render-time throw anywhere in the tree would otherwise blank the app — and
// in the headset there's no console to explain it. Catch it, log it, and show a
// human message with a reload, instead of a black void.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Panel] render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          font: '16px/1.5 system-ui, sans-serif',
          color: '#f2eeea',
          background: '#141010',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <strong style={{ color: '#e2483a', fontSize: 22 }}>Panel hit a snag</strong>
        <p style={{ maxWidth: 420, margin: 0 }}>
          Something went wrong rendering the app. Reloading usually clears it.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            font: '600 15px system-ui, sans-serif',
            color: '#f2eeea',
            background: '#b02c22',
            border: '2px solid #120d0b',
            borderRadius: 6,
            padding: '10px 22px',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
