import { Component, ReactNode, ErrorInfo } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/**
 * Top-level error boundary.
 * Catches render errors, logs to Sentry if available, shows a friendly fallback.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
    // Report to Sentry if it was loaded
    try {
      const Sentry = (window as any).__SENTRY__;
      Sentry?.captureException(error, { extra: { componentStack: info.componentStack } });
    } catch { /* Sentry not available */ }
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white/80 rounded-3xl shadow-lg p-8 text-center">
          <div className="text-5xl mb-4">🪶</div>
          <h1 className="font-serif text-2xl font-bold text-[#1e2d1f] mb-2">
            Что-то пошло не так
          </h1>
          <p className="text-[#1e2d1f]/55 text-sm mb-6 leading-relaxed">
            Приложение столкнулось с ошибкой. Ваши тексты в безопасности — они сохраняются автоматически.
          </p>
          <pre className="text-left text-xs bg-[#f5f0e8] rounded-xl p-3 mb-6 text-[#1e2d1f]/50 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <button
            onClick={this.handleReload}
            className="w-full py-3 px-6 bg-[#1e2d1f] text-white rounded-xl font-medium hover:bg-[#2a3f2b] transition-colors"
          >
            Вернуться на главную
          </button>
        </div>
      </div>
    );
  }
}
