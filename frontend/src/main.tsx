import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', color: '#721c24', background: '#fdf0ef', border: '1px solid #f5c6cb', borderRadius: 8, margin: '2rem' }}>
          <b>Помилка рендеру:</b>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 8 }}>{String(error)}{'\n'}{(error as Error).stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: '6px 16px', cursor: 'pointer' }}>Спробувати ще раз</button>
        </div>
      )
    }
    return this.state.error ? null : this.props.children
  }
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
