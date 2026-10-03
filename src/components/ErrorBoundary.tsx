import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Mirrors STORAGE_KEY in state/document.ts; kept local so the last-resort
 * boundary doesn't import the module graph that may be what crashed. */
const GRAPH_KEY = 'comp.graph';

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

  /*
   * Reset is the last resort, and the saved graph may be exactly what makes
   * the app crash -- but it is also the user's work. So it is never simply
   * deleted: a copy goes to a timestamped key first, and if that copy can't
   * be written (quota, private mode) the reset doesn't happen at all.
   */
  private handleReset = (): void => {
    try {
      const saved = localStorage.getItem(GRAPH_KEY);
      if (saved !== null) {
        // Keep only the few most recent backups, so repeated resets can't
        // fill the storage quota and break normal autosave.
        const prefix = `${GRAPH_KEY}.backup-`;
        const old = Object.keys(localStorage)
          .filter((key) => key.startsWith(prefix))
          .sort()
          .slice(0, -2);
        for (const key of old) localStorage.removeItem(key);
        localStorage.setItem(`${prefix}${Date.now()}`, saved);
      }
      localStorage.removeItem(GRAPH_KEY);
    } catch {
      window.alert(
        'The saved project could not be backed up, so it was left in place. ' +
          'Use "Download project JSON" to keep a copy before resetting.',
      );
      return;
    }
    window.location.reload();
  };

  private handleDownload = (): void => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(GRAPH_KEY);
    } catch {
      // Storage access might be restricted
    }
    if (saved === null) {
      window.alert('There is no saved project to download.');
      return;
    }
    // The raw string, untouched: if it's malformed, that's worth seeing too.
    const url = URL.createObjectURL(new Blob([saved], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `comp-project-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke on the next tick; some browsers cancel a download revoked
    // synchronously after the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
            backgroundColor: 'var(--bg-base)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          <div
            className="glass"
            style={{
              maxWidth: '480px',
              width: '100%',
              padding: '28px',
              borderRadius: '20px',
              boxShadow: '0 12px 32px rgba(var(--shadow-rgb), 0.12)',
              background: 'rgba(var(--paper-rgb), 0.65)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(var(--paper-rgb), 0.8)',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 600 }}>
              Something went wrong
            </h2>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5 }}>
              An unexpected error occurred in the editor. You can reload the page, download the saved project, or reset it (a backup copy is kept in this browser).
            </p>
            {this.state.error && (
              <pre
                style={{
                  margin: '0 0 20px',
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(var(--ink-rgb), 0.05)',
                  fontSize: '11px',
                  color: 'var(--danger-text)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(var(--ink-rgb), 0.15)',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={this.handleDownload}
                title="Downloads the saved project exactly as stored"
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(var(--ink-rgb), 0.12)',
                  background: 'rgba(var(--paper-rgb), 0.8)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Download project JSON
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                title="Backs up the saved project, then reloads a fresh default graph"
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: '999px',
                  border: '1px solid rgba(var(--ink-rgb), 0.12)',
                  background: 'rgba(var(--paper-rgb), 0.8)',
                  color: 'var(--danger-text)',
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
