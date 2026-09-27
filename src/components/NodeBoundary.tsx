import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { getEffect } from '../engine/registry';

/**
 * Per-node error boundary. Without it, one module throwing during render
 * unwinds all the way to the root boundary and the whole canvas goes with
 * it -- a bad parameter on one card shouldn't cost the user their view of
 * the rest of the graph.
 *
 * The fallback is deliberately just a card: no React Flow handles. Its wires
 * lose their anchor for as long as it's showing, which is the honest picture
 * (the node isn't producing anything), and rendering handles from a crashed
 * component's props is exactly the kind of guesswork that could throw again.
 */

type BoundaryProps = {
  title: string;
  children: ReactNode;
};

type BoundaryState = {
  error: Error | null;
};

class NodeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Node "${this.props.title}" crashed:`, error, info);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="node node-crashed" role="alert">
        <div className="node-title">
          <TriangleAlert size={13} />
          <span>{this.props.title}</span>
        </div>
        <div className="node-body">
          <p className="node-crashed-message" title={error.message}>
            {error.message || 'This module failed to render.'}
          </p>
          <button type="button" className="node-crashed-retry nodrag" onClick={this.retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
}

/** Best-effort title from whatever node props came in; never throws. */
function titleFrom(props: object): string {
  try {
    const { type, data } = props as { type?: unknown; data?: Record<string, unknown> };
    if (data && typeof data.effectId === 'string') {
      const label = getEffect(data.effectId)?.label;
      if (label) return label;
    }
    if (typeof type === 'string' && type) return type.charAt(0).toUpperCase() + type.slice(1);
  } catch {
    // Fall through: a crashed node's data is exactly what we can't trust.
  }
  return 'Module';
}

export function withNodeBoundary<P extends object>(
  Wrapped: React.ComponentType<P>,
): React.ComponentType<P> {
  const Bounded = (props: P) => (
    <NodeErrorBoundary title={titleFrom(props)}>
      <Wrapped {...props} />
    </NodeErrorBoundary>
  );
  Bounded.displayName = `withNodeBoundary(${Wrapped.displayName ?? Wrapped.name ?? 'Node'})`;
  return Bounded;
}
