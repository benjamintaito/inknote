import { Component, ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  message?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      const displayMessage =
        this.props.message ??
        this.state.error?.message ??
        'Se produjo un error inesperado.'

      return (
        <div className="flex flex-1 items-center justify-center w-full h-full bg-gray-900">
          <div className="flex flex-col items-center gap-4 p-8 max-w-sm text-center">
            <div className="text-5xl select-none">⚠️</div>
            <h2 className="text-xl font-semibold text-white">Algo salió mal</h2>
            <p className="text-sm text-gray-400 break-words">{displayMessage}</p>
            <div className="flex gap-3 mt-2">
              <button
                className="px-4 py-2 rounded-md bg-gray-700 text-white text-sm font-medium hover:bg-gray-600 transition-colors"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Reintentar
              </button>
              <button
                className="px-4 py-2 rounded-md bg-gray-700 text-white text-sm font-medium hover:bg-gray-600 transition-colors"
                onClick={() => window.location.reload()}
              >
                Recargar app
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
