# COMP STUDIO

A node-based compositing tool for the browser, at
[comp.pantoine.com](https://comp.pantoine.com). Bring in an image or a video,
or generate one, wire it through effect modules, drive their knobs with
modulators, and watch the result in a viewer — or render it out to a file.

```bash
npm install
npm run dev      # dev server
npm test         # vitest
npm run build    # typecheck + shader check + production bundle
```

## How it fits together

- **`src/engine/`** — the renderer. Every effect is a WebGL2 fragment shader;
  effects chain through ping-pong framebuffers at the source's own resolution
  (capped for the live viewers), and a final pass blits the result into the
  viewer with aspect fit. Effect definitions live one per file in
  `engine/modules/`, modulators (LFO, Noise, Pulse, Value, Math, Map Range) in
  `engine/modulators.ts`.
- **`src/state/`** — the graph. `store.ts` holds nodes, edges and parameters;
  `graph.ts` walks backwards from a sink (Viewer, Background, Render) to
  resolve what needs drawing; `document.ts` saves to `localStorage` and
  handles JSON import/export and old document versions.
- **`src/components/`** — the UI. One generic `EffectNode` renders every
  effect from its spec; the palette menus and the Shift+A quick-add both read
  from `paletteCatalog.ts`.

Node kinds, left to right:

| Kind | Nodes |
| :--- | :--- |
| Inputs | Image, Video, generators (Ramp, Noise) |
| Modules | every entry in `engine/registry.ts`, plus modulator operators |
| Modulators | LFO, Noise, Pulse, Value (sources); Math, Map Range (operators) |
| Outputs | Viewer, Background, Render (bakes PNG, JPG, GIF, MP4 or WebM), Exporter (downloads it) |

Wires are colour coded: blue for images, amber for modulation (a modulator's
`mod` port into a knob's `param:<key>` port), purple for rendered assets.

### Fields: pictures as parameters

Sockets follow Blender. Any knob with a **diamond** port also takes a
picture. The knob then has a value at every pixel (a *field*), and the wire
is drawn dashed blue. The control stays where it is, at the same size, but is
greyed out and locked. Types convert the way Blender converts them:

| Into | From a picture | From a number |
| :--- | :--- | :--- |
| float | luminance, raw (0..1 for a normal picture) | as is |
| int / menu | luminance, truncated | truncated |
| toggle | luminance > 0 | > 0 |
| colour | RGB | grey |
| vec2 | RG | same on both axes |

Values arrive raw, so scale them the Blender way. Math and Map Range
become per-pixel as soon as a picture reaches one of their ports: their
output lug turns into a blue diamond. Map
Range's Auto range treats a picture as 0..1, so *picture → Map Range → Blur
radius* is enough to get "more blur where the mask is bright". Per-pixel
maths works on each channel, like Vector Math, and runs in half float, so
values past 1 survive.

Round ports need a single number: phased params (`speed`, `rate`, `roll`),
the particle sim, source modulators and a video's speed. A field that
reaches one through a Math stays wired but is drawn **red**, and the port
keeps its own value until the wiring is fixed.

The other direction works too:
- A number wired where a picture goes becomes a flat grey.
- **Image Statistic** (in the Module menu) reads a picture's mean, min,
  max, range or standard deviation back out as a signal. The renderer
  measures it inside the frame, before anything that reads it is drawn, so
  a knob follows the picture on the same frame in exports too.

Under the hood, `buildFragmentSource(def, pass, fields)` turns each
fielded `uniform <type> u_<key>` into a global filled from
`u_<key>_field` at the top of `main`. Module bodies never need to know a
field exists.

Decoded bitmaps and video elements live in `engine/imageStore.ts` and
`engine/videoStore.ts`, deliberately outside the store, so graph state stays
serializable and slider drags don't push pixel data through React.

## Adding an effect

One file and one line. Create `src/engine/modules/myeffect.ts`:

```ts
import type { EffectDef } from '../effects';

export const myeffect: EffectDef = {
  id: 'myeffect',
  label: 'My Effect',
  category: 'color',        // which group of the Module menu it lands in
  animated: false,          // true -> renderer switches to a continuous loop
  mixable: true,            // adds a Mix knob that crossfades against the input
  params: [
    { kind: 'float', key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  fragment: `  vec4 src = texture(u_src, v_uv);
  fragColor = vec4(src.rgb * u_amount, src.a);`,
};
```

Then add it to the array in `src/engine/registry.ts`, under its category. It
appears in the Module menu and quick-add, and gets its controls generated
automatically.

Each `params` entry becomes a `uniform <type> u_<key>`. Every effect also gets
`u_src` (the previous stage), `u_orig`, `u_resolution`, `u_time` in seconds,
`u_delta`, `u_frame`, `u_seed` and `u_pass`, plus the helpers in
`engine/stdlib.ts`. An effect that reads `u_time` should set `animated: true`
(or a function of its params) so the render loop runs continuously —
otherwise the view only redraws when something changes. See
`effects.ts` for multi-pass (`fragment` as an array), feedback (`u_prev`) and
extra image inputs.

`npm run check:shaders` parses every shader offline and catches GLSL
reserved words before the browser does; it runs as part of `npm run build`.

## Notes

- Textures are decoded flipped (`imageStore.decodeImage`) because
  `UNPACK_FLIP_Y_WEBGL` is ignored for `ImageBitmap` sources. Every texture in
  the renderer is therefore already in GL orientation. Video frames are
  flipped on upload instead.
- The Viewer node's React Flow type is `renderOutput`, not `output` — the
  latter collides with React Flow's built-in node styles.
- The graph canvas runs full bleed under the viewer. `fitViewOptions` in
  `App.tsx` reserves that space by hand, mirroring `--render-width` and
  `--gutter` in `styles/glass.css`; those two need to move together.
- Pull requests run `npm test` and `npm run build` via
  `.github/workflows/ci.yml`. Deploys happen on every push to `main` via
  `.github/workflows/deploy.yml`. The custom domain lives in `public/CNAME`,
  which Vite copies into `dist`.
- `gemini.md` is the longer guide for AI coding assistants.
