import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    try {
      localStorage.removeItem('comp.graph');
    } catch {
      // Storage access might be restricted
    }
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '24px',
            backgroundColor: '#e8e8ea',
            color: '#17171a',
            fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
          }}
        >
          <div
            className="glass"
            style={{
              maxWidth: '480px',
              width: '100%',
              padding: '28px',
              borderRadius: '20px',
              boxShadow: '0 12px 32px rgba(23, 23, 26, 0.12)',
              background: 'rgba(255, 255, 255, 0.65)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.8)',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 600 }}>
              Something went wrong
            </h2>
            <p style={{ margin: '0 0 16px', color: '#5d5d66', fontSize: '13px', lineHeight: 1.5 }}>
              An unexpected error occurred in the editor. You can reload the page or reset the saved project state.
            </p>
            {this.state.error && (
              <pre
                style={{
                  margin: '0 0 20px',
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(23, 23, 26, 0.05)',
                  fontSize: '11px',
                  color: '#b02a2a',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(23, 23, 26, 0.15)',
                  background: '#17171a',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                title="Clears localStorage and reloads a fresh default graph"
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(23, 23, 26, 0.12)',
                  background: 'rgba(255, 255, 255, 0.8)',
                  color: '#b02a2a',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Reset Project
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
