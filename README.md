# COMP STUDIO

A node-based compositing tool for the browser, at
[comp.pantoine.com](https://comp.pantoine.com). Import an image, wire it
through effect modules, and watch the result in the render view.

## How it fits together

- **`src/engine/`** — the renderer. Every effect is a fragment shader; effects
  chain through ping-pong framebuffers at the image's own resolution, and a
  final pass blits the result into the render view with aspect fit.
- **`src/state/`** — the graph. `store.ts` holds nodes, edges and parameters;
  `graph.ts` walks backwards from the Output node to resolve the effect chain.
- **`src/components/`** — the UI. One generic `EffectNode` renders every
  effect from its spec.

Decoded bitmaps live in `engine/imageStore.ts`, deliberately outside the
store, so graph state stays serializable and slider drags don't push pixel
data through React.

## Adding an effect

One file and one line. Create `src/engine/myeffect.ts`:

```ts
import type { EffectDef } from './effects';

export const myeffect: EffectDef = {
  id: 'myeffect',
  label: 'My Effect',
  animated: false,          // true -> renderer switches to a continuous loop
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  fragColor = vec4(src.rgb * u_amount, src.a);`,
};
```

Then add it to the array in `src/engine/registry.ts`. It appears in the
"Add module" menu and gets its sliders generated automatically.

Each `params` entry becomes a `uniform float u_<key>`. Every effect also gets
`u_src` (the previous stage), `u_resolution` and `u_time` in seconds. An
effect that reads `u_time` should set `animated: true` so the render loop runs
continuously — otherwise the view only redraws when something changes.

## Notes

- Textures are decoded flipped (`imageStore.decodeImage`) because
  `UNPACK_FLIP_Y_WEBGL` is ignored for `ImageBitmap` sources. Every texture in
  the renderer is therefore already in GL orientation.
- The Output node's React Flow type is `renderOutput`, not `output` — the
  latter collides with React Flow's built-in node styles.
- The graph canvas runs full bleed under the render view. `fitViewOptions` in
  `App.tsx` reserves that space by hand, mirroring `--render-width` and
  `--gutter` in `styles/glass.css`; those two need to move together.
- Deploys happen on every push to `main` via `.github/workflows/deploy.yml`.
  The custom domain lives in `public/CNAME`, which Vite copies into `dist`.
