import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGraph } from '../state/store';
import { chainIsAnimated, resolveChain } from '../state/graph';
import { Pipeline } from '../engine/pipeline';
import { createContext } from '../engine/gl';
import { getImage } from '../engine/imageStore';

/** Retina is worth it; beyond 2x is pixels nobody can see. */
const MAX_DPR = 2;

/** Shape of the empty frame, before there is a picture to take one from. */
const DEFAULT_RATIO = 16 / 9;

/**
 * The fixed panel on the right: whatever is wired into the Output node.
 *
 * Owns the GL context and the frame loop. The loop only runs continuously
 * when something in the chain is animated -- a graph of flat effects redraws
 * on change and then sits idle, which is what keeps a laptop fan quiet while
 * the user is just arranging nodes.
 */
export const RenderView: React.FC = () => {
  const nodes = useGraph((state) => state.nodes);
  const edges = useGraph((state) => state.edges);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const startRef = useRef(performance.now());
  const [unsupported, setUnsupported] = useState(false);

  const chain = resolveChain(nodes, edges);
  const animated = chainIsAnimated(chain);

  // Held in a ref so the draw callback can stay stable across node drags,
  // which change the nodes array without changing what gets rendered.
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Redraw only when something the picture depends on actually moved.
  const signature = chain
    ? JSON.stringify([chain.sourceNodeId, chain.passes.map((pass) => [pass.def.id, pass.params])])
    : 'empty';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipeline = pipelineRef.current;
    if (!canvas || !pipeline) return;

    const current = chainRef.current;
    const image = current ? getImage(current.sourceNodeId) : undefined;
    if (!current || !image) {
      pipeline.clear(canvas.width, canvas.height);
      return;
    }

    pipeline.render({
      nodeId: current.sourceNodeId,
      image,
      passes: current.passes,
      time: (performance.now() - startRef.current) / 1000,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Context and pipeline, once for the life of the panel.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = createContext(canvas);
    if (!gl) {
      setUnsupported(true);
      return;
    }
    pipelineRef.current = new Pipeline(gl);
    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, []);

  // Match the drawing buffer to the panel's on-screen size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      drawRef.current();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw, signature]);

  useEffect(() => {
    if (!animated) return;
    let frame = 0;
    const tick = () => {
      drawRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated]);

  const image = chain ? getImage(chain.sourceNodeId) : undefined;

  /*
   * The frame takes the picture's shape rather than the picture being
   * letterboxed inside a fixed one, so the panel hugs its content and the
   * checkerboard only ever shows where the image is genuinely transparent.
   */
  const stageStyle = {
    '--stage-ratio': image ? image.width / image.height : DEFAULT_RATIO,
  } as React.CSSProperties;

  return (
    <aside className="glass render-view" style={stageStyle}>
      <header className="render-head">
        <span className="render-title">Render</span>
        <span className="render-info">
          {image ? image.width + ' × ' + image.height : '—'}
        </span>
      </header>

      <div className="render-stage" style={stageStyle}>
        <canvas ref={canvasRef} className="render-canvas" />
        {unsupported && <p className="render-empty">This browser has no WebGL2.</p>}
        {!unsupported && !chain && (
          <p className="render-empty">
            Wire an image into the <strong>Output</strong> node to see it here.
          </p>
        )}
      </div>

      <footer className="render-foot">
        <span className={'render-dot' + (chain ? ' is-live' : '')} />
        <span>{chain ? (animated ? 'Playing' : 'Live') : 'Idle'}</span>
        {chain && <span className="render-chain">{chain.passes.length} effect{chain.passes.length === 1 ? '' : 's'}</span>}
      </footer>
    </aside>
  );
};
