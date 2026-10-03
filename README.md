# COMP STUDIO

A modular compositing tool for the browser, at
[comp.pantoine.com](https://comp.pantoine.com). Bring in an image or a video,
or generate one, wire it through effect modules, drive their knobs with
modulators, and watch the result in a viewer — or render it out to a file.
Modules can be grouped into one card and saved as presets that come back as
groups.

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
  `engine/modules/`, generators in `engine/generators.ts`, modulators in
  `engine/modulators.ts`. Each step has a frame of its own (`frames.ts`), so
  a Resize / Crop changes the size of everything after it on the main path.
- **`src/state/`** — the graph. `store.ts` holds nodes, edges and parameters;
  `graph.ts` walks backwards from a sink (Viewer, Background, Render) to
  resolve what needs drawing; `document.ts` saves to `localStorage` and
  handles JSON import/export and old document versions. `groups.ts` and
  `presets.ts` (with `builtinPresets.ts`) handle groups and presets;
  `theme.ts` the light / dark theme.
- **`src/components/`** — the UI. One generic `EffectNode` renders every
  effect from its spec; the palette menus and the Shift+A quick-add both read
  from `paletteCatalog.ts`.
- **`src/styles/glass.css`** — every style, built on the tokens at its top.

Node kinds, left to right:

| Kind | Nodes |
| :--- | :--- |
| Inputs | Image, Video, generators (Ramp, Noise, Plasma, Cellular, Pattern) |
| Modules | every entry in `engine/registry.ts`, plus modulator operators |
| Modulators | LFO, Noise, Pulse, Value, Step Sequencer (sources); Math, Map Range, Image Statistic, Sample & Hold, Smooth, Envelope (operators) |
| Outputs | Viewer, Background, Render (bakes PNG, JPG, GIF, MP4 or WebM), Exporter (downloads it) |
| Groups | any modules wired together in one flow, shown as one card |

Images and videos can also come in by dropping files on the canvas or
pasting them from the clipboard.

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

### Groups and presets

A group (`moduleGroup` node) is display only: its members stay in the graph,
hidden, and the wires into and out of them are redrawn to the group card's
ports. Rendering never sees the group, so ungrouping is lossless. A group can
expose any of its members' params on its card, and be dropped on a wire like
a single module.

A preset is a saved flow plus the params it exposes. Placing one adds it as a
group. User presets live in `localStorage` (`comp.presets`), apart from the
document; the built-in ones (Toon, Slit-Scan) are defined in code in
`state/builtinPresets.ts`.

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
appears in the Module menu and quick-add, sorted alphabetically within its
category, and gets its controls generated automatically. Categories are
`color`, `stylize`, `optics`, `geometry`, `crt`, `tape`, `noise`,
`temporal`, `composite` and `generator` (see `Category` in `effects.ts`).

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

## Styling and themes

All colours in `glass.css` are tokens on `:root`, mostly as RGB channels so
a tint is one alpha away: `--ink-rgb` (type, washes, hairlines), `--paper-rgb`
(the glass sheet), `--rim-rgb` (the catchlight on a sheet's edge),
`--ring-rgb` (a sheet's outline) and `--shadow-rgb`. Dark mode is the same
recipe with different values under `:root[data-theme='dark']`: ink and paper
swap, rings and shadows stay dark. Port colours are the only hues and don't
change. A new rule should use the tokens, never a literal colour.

The theme follows the system unless the toggle next to Shortcuts & info pins
it, and is stored per browser (`comp.theme`), not in the document. An inline
script in `index.html` applies it before first paint, so a dark screen does
not flash light. It repeats the rule in `state/theme.ts`; keep the two in
step.

Three fonts, from Google Fonts in `index.html`: `--font-display` (Bricolage
Grotesque) for the name, module titles and dialog headings; `--font-ui`
(Instrument Sans) for everything else; `--font-mono` (DM Mono) for numbers
and keys. They are assigned in the Typefaces section at the end of
`glass.css`, which has to stay last. Only the weights loaded in `index.html`
exist, so don't ask a font for more.

## Notes

- Textures are decoded flipped (`imageStore.decodeImage`) because
  `UNPACK_FLIP_Y_WEBGL` is ignored for `ImageBitmap` sources. Every texture in
  the renderer is therefore already in GL orientation. Video frames are
  flipped on upload instead.
- The Viewer node's React Flow type is `renderOutput`, not `output` — the
  latter collides with React Flow's built-in node styles.
- User-facing text calls the boxes on the canvas **modules**; the code
  calls them nodes, as React Flow does. Keep it that way in new labels,
  hints and tour copy.
- The keyboard shortcuts are listed by hand in two places besides their
  bindings: `components/shortcutList.ts` (the Shortcuts & info dialog) and
  `components/shortcutHints.ts` (the context hints at the bottom of the
  canvas). A new shortcut belongs in both.
- The version shown in Shortcuts & info is read from `package.json`; bump it
  there (`npm version <x.y.z> --no-git-tag-version`).
- The welcome tour's clips are `public/welcome/step-*.mp4`. Replacing one,
  bump `CLIP_VERSION` in `components/welcomeSteps.ts` so browsers drop the
  cached copy.
- Pull requests run `npm test` and `npm run build` via
  `.github/workflows/ci.yml`. Deploys happen on every push to `main` via
  `.github/workflows/deploy.yml`. The custom domain lives in `public/CNAME`,
  which Vite copies into `dist`.
- `gemini.md` is the longer guide for AI coding assistants.
