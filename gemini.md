# Comp Studio (`comp.pantoine.com`) — AI Developer Guide

Welcome to **Comp Studio**, a real-time, browser-based node compositing and visual effects application built with React, WebGL2, and React Flow.

This document (`gemini.md`) provides everything an AI coding assistant needs to understand the project architecture, design philosophy, technical constraints, coding patterns, and verification workflows.

---

## 1. High-Level Architecture & Philosophy

Comp Studio lets users build compositing graphs by connecting media sources (images, videos), effect modules (shaders), modulators (LFOs, math, signals), and outputs (viewer, background, file renderers, exporters).

### Core Design Principles

1. **Strict Separation of State vs Media Data**:
   - The Zustand store (`src/state/store.ts`) holds **only serializable graph metadata**: node positions, connections (edges), parameter values, and filenames.
   - Raw media buffers (decoded `ImageBitmap`, `<video>` elements, WebGL textures) are held outside the store in `imageStore.ts` and `videoStore.ts`.
   - *Rationale*: Prevents multi-megabyte binary pixel data from churning React component trees or breaking undo/redo history and document persistence.

2. **Atomic Shader Modules**:
   - Effects do one visible thing well (e.g., `scanlines`, `lens`, `chromaticAberration`, `grain`). Complex aesthetics (like a retro CRT look) are built by chaining atomic nodes rather than creating monolithic 40-slider nodes.
   - Modularity enables re-ordering passes (e.g., putting scanlines before vs after a lens warp).

3. **Demand-Driven Render Loop**:
   - The canvas does not run an unconstrained 60fps render loop if the graph is static.
   - Continuous frame rendering is activated **only** when `chainIsAnimated(chain)` returns `true` (e.g. video source attached, animated shader with non-zero speed, or active moving modulators).

4. **Backward Graph Resolution**:
   - Rendering walks backwards from the active viewer/output sink (`OutputNode`, `RenderNode`, `BackgroundNode`) towards sources via DFS.
   - Unconnected nodes or nodes on disjoint branches consume zero GPU compute.

```
┌────────────────────────────────────────────────────────┐
│                   User Interaction                     │
│        (React Flow Canvas, Sliders, Transport)         │
└───────────────────────────┬────────────────────────────┘
                            │ Updates params / graph
                            ▼
┌────────────────────────────────────────────────────────┐
│                 Zustand Graph State                    │
│    (src/state/store.ts, graph.ts, document.ts)        │
└─────────────┬────────────────────────────┬─────────────┘
              │ Triggers chain resolution  │ Image / Video IDs
              ▼                            ▼
┌───────────────────────────┐    ┌───────────────────────┐
│     RenderPlan & Passes   │    │  imageStore / video   │
│   (Topological DFS Steps) │    │  (Raw Bitmaps/Videos) │
└─────────────┬─────────────┘    └───────────┬───────────┘
              │                              │
              ▼                              ▼
┌────────────────────────────────────────────────────────┐
│               WebGL2 Engine (Pipeline)                 │
│  - TargetPool Ping-Pong Framebuffers                   │
│  - GLSL ES 3.00 Shader Program Cache                   │
│  - Feedback History (u_prev) & Phased Uniforms         │
│  - Aspect-Fit Quad Blit to Screen / Export Canvas      │
└────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
.
├── index.html                 # App shell entry point
├── vite.config.ts             # Vite build configuration (React plugin)
├── tsconfig.json              # TypeScript strict configuration
├── scripts/
│   └── check-shaders.mjs      # Offline GLSL validator (reserved words + AST parse)
├── public/
│   ├── CNAME                  # comp.pantoine.com domain
│   └── favicon.svg
├── src/
│   ├── main.tsx               # React root mount
│   ├── App.tsx                # Main canvas container, React Flow setup, hotkeys
│   ├── styles/
│   │   └── glass.css          # Glassmorphic UI styles, CSS variables, node themes
│   ├── types/
│   │   └── gifenc.d.ts        # Type declarations for gifenc
│   ├── state/                 # State management & document model
│   │   ├── store.ts           # Central Zustand store (useGraph), actions, copy/paste
│   │   ├── graph.ts           # Topological graph walk, resolveChain, port typing
│   │   ├── document.ts        # JSON export/import, localStorage persistence, migrations
│   │   ├── history.ts         # Undo / Redo history manager
│   │   └── snapping.ts        # Node dragging alignment guides & snapping
│   ├── engine/                # WebGL2 rendering engine & math
│   │   ├── gl.ts              # WebGL2 context, quad drawing, uniform helpers
│   │   ├── pipeline.ts        # Pipeline class: target pool, program cache, execution
│   │   ├── targets.ts         # Framebuffer ping-pong target allocator (TargetPool)
│   │   ├── effects.ts         # EffectDef, ParamSpec, shader prelude, uniform generation
│   │   ├── registry.ts        # Registry of all effect definitions
│   │   ├── stdlib.ts          # Shared GLSL functions injected into every shader
│   │   ├── imageStore.ts      # Storage for loaded ImageBitmaps
│   │   ├── videoStore.ts      # Storage for HTMLVideoElements
│   │   ├── modulators.ts      # LFO, Noise, Math, Envelope signal generators
│   │   ├── clock.ts           # Playback transport, time synchronization, time wrapping
│   │   ├── exportEngine.ts    # Headless recorder for PNG, JPG, GIF, MP4, WebM
│   │   ├── shaderErrors.ts    # Error listener for shader compilation issues
│   │   ├── particleSim.ts     # Particle simulation renderer (point sprite passes)
│   │   ├── particleStore.ts   # CPU/GPU particle simulation buffer manager
│   │   └── modules/           # All individual EffectDef implementations (*.ts)
│   └── components/            # React UI components & React Flow custom nodes
│       ├── ImageNode.tsx      # Image source node (drop / file input)
│       ├── VideoNode.tsx      # Video source node (playback controls / scrubbing)
│       ├── EffectNode.tsx     # Generic effect node rendered from EffectDef
│       ├── ModulatorNode.tsx  # Signal generator node with mini-waveform preview
│       ├── OutputNode.tsx     # Primary interactive viewer node (WebGL canvas)
│       ├── BackgroundNode.tsx # Canvas background viewer config node
│       ├── FullScreenBackground.tsx # Renders composite behind the graph canvas
│       ├── RenderNode.tsx     # Offscreen format baker (duration, scale, fps)
│       ├── ExportNode.tsx     # Downstream file downloader
│       ├── Toolbar.tsx        # Top toolbar (Add module, import, undo/redo, share)
│       ├── Transport.tsx      # Bottom playback transport controls
│       ├── QuickAdd.tsx       # Quick search module palette (Cmd+K / Tab)
│       ├── LinkEdge.tsx       # Custom bezier wire with delete button & hit target
│       ├── SnapGuides.tsx     # Visual alignment guide overlay
│       ├── AboutModal.tsx     # Info and shortcut overlay
│       └── controlPrimitives.tsx # Sliders, toggles, color pickers, number fields
```

---

## 3. Technology Stack & Key Dependencies

- **Language**: TypeScript (`~5.7.2`) with `strict: true`
- **Framework**: React 19 (`react`, `react-dom`)
- **Graph UI**: `@xyflow/react` (`^12.3.5`)
- **State Store**: `zustand` (`^5.0.2`)
- **Icons**: `lucide-react`
- **Rendering**: Raw WebGL 2.0 (GLSL ES 3.00)
- **Shader Validation**: `@shaderfrog/glsl-parser` + `esbuild`
- **Animation & Encoding**: `gifenc` for fast GIF rendering, native `MediaRecorder` for MP4/WebM
- **Bundler & Dev Server**: Vite (`^6.2.0`)
- **Unit Testing**: Vitest (`^5.0.1`)

---

## 4. WebGL2 & Shader Rules (Critical Invariants)

All effects compile into WebGL 2.0 fragment shaders. The framework automatically generates headers, uniforms, and wraps your fragment code inside `void main()`.

### 4.1. Prelude and Injected Built-in Uniforms

Every effect receives the standard prelude (`src/engine/effects.ts`) and stdlib (`src/engine/stdlib.ts`):

```glsl
#version 300 es
precision highp float;

in vec2 v_uv;                 // Normalized coordinates [0, 1]
out vec4 fragColor;           // Output color (MUST write to this)

uniform sampler2D u_src;       // Input from previous pass / stage
uniform sampler2D u_orig;      // Original input to this multi-pass effect
uniform sampler2D u_prev;      // Output from previous frame (if feedback: true)
uniform vec2 u_resolution;     // Working buffer resolution in pixels
uniform float u_time;          // Running time in seconds (wrapped)
uniform float u_delta;         // Frame delta time in seconds (clamped)
uniform int u_frame;           // Monotonic frame counter
uniform float u_seed;          // Stable pseudo-random float per node [0, 1]
uniform int u_pass;            // Current pass index (for multi-pass effects)
```

### 4.2. STDLIB Functions Available in All Shaders (`stdlib.ts`)

- `TAU`: `6.28318530718`
- `sat(float x)`: Clamps value to `[0.0, 1.0]`
- `luma(vec3 c)`: Rec. 709 perceived luminance (`dot(c, vec3(0.2126, 0.7152, 0.0722))`)
- `hash11(float)`, `hash12(vec2)`, `hash22(vec2)`: Fast deterministic noise hashes
- `valueNoise(vec2 p)`: Smoothed 2D lattice noise in `[0, 1]`
- `fbm(vec2 p, int octaves)`: Fractal brownian motion (up to 8 octaves)
- `hueRotate(vec3 c, float angle)`: Rotate color hue preserving luminance
- `aspectUv(vec2 uv, vec2 resolution)`: Corrects UV aspect ratio centered at `(0, 0)`
- `sampleEdge(sampler2D tex, vec2 uv, int mode)`: Edge wrapping: `0` clamp, `1` wrap, `2` black, `3` mirror
- `blurAxis(sampler2D tex, vec2 uv, vec2 res, vec2 dir, float radius)`: 1D Gaussian blur tap
- `wave(float phase, int shape)`: LFO oscillator (`0` sine, `1` triangle, `2` square, `3` noise)

### 4.3. GLSL Strict Rules & Reserved Words

1. **GLSL ES 3.00 Syntax**:
   - Write to `fragColor = ...`, **never** `gl_FragColor`.
   - Sample textures with `texture(u_src, uv)`, **never** `texture2D(...)`.
2. **Reserved Identifiers**:
   - GLSL ES 3.00 forbids many words as variable names. The static linter (`check-shaders.mjs`) will reject:
     `common`, `partition`, `active`, `asm`, `class`, `union`, `enum`, `typedef`, `template`, `this`, `resource`, `goto`, `inline`, `noinline`, `public`, `static`, `extern`, `external`, `interface`, `long`, `short`, `half`, `fixed`, `unsigned`, `superp`, `input`, `output`, `filter`, `sizeof`, `cast`, `namespace`, `using`, `attribute`, `varying`, `coherent`, `volatile`, `restrict`, `readonly`, `writeonly`, `atomic_uint`, etc.
   - **Never name a local variable `active`, `input`, `output`, or `filter`!**
3. **No Uniforms Inside Functions**:
   - Uniforms are declared by the framework at the top level. Do not declare `uniform` inside a function body.
4. **Reserved Param Keys**:
   - Effect parameter keys become `u_<key>`. You **cannot** name a param:
     `src`, `orig`, `prev`, `resolution`, `time`, `delta`, `frame`, `seed`, `pass`.
5. **Phase Uniforms**:
   - Parameters named `speed`, `rate`, or `roll` automatically generate an integrated phase uniform `uniform float u_phase_<key>;`. Use this instead of `u_time * u_speed` when modulating speed so that rate changes don't jump discontinuously.

---

## 5. Guide: Creating an Effect Module

To add an effect, create a single file in `src/engine/modules/<effectName>.ts` and export an `EffectDef`:

```ts
import type { EffectDef } from '../effects';

export const invert: EffectDef = {
  id: 'invert',
  label: 'Invert',
  category: 'color',
  animated: false,
  mixable: true, // Injects a standard "Mix" (0..1) slider and crossfades output
  params: [
    {
      kind: 'float',
      key: 'intensity',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
    },
  ],
  fragment: `
  vec4 src = texture(u_src, v_uv);
  vec3 inverted = mix(src.rgb, 1.0 - src.rgb, u_intensity);
  fragColor = vec4(inverted, src.a);
  `,
};
```

Then register it in `src/engine/registry.ts`:

```ts
import { invert } from './modules/invert';

export const registry: EffectDef[] = [
  // ...
  invert,
];
```

### Parameter Types (`ParamSpec`)

| `kind` | GLSL Type | TypeScript Default | Control Rendered |
| :--- | :--- | :--- | :--- |
| `'float'` | `float` | `number` | Slider (or number box if `field: true`) |
| `'int'` | `int` | `number` | Stepped slider |
| `'bool'` | `bool` | `boolean` | Toggle switch |
| `'enum'` | `int` | `number` (index) | Dropdown selection |
| `'color'` | `vec3` | `[r, g, b]` (0..1) | Color swatch & hex picker |
| `'vec2'` | `vec2` | `[x, y]` | 2D coordinate joystick / sliders |

### Multi-Pass Effects (e.g., Separable Blurs)

Provide an array of fragment strings to `fragment`:
```ts
export const twoPassBlur: EffectDef = {
  id: 'twopass',
  // ...
  fragment: [
    // Pass 0: Horizontal
    `fragColor = blurAxis(u_src, v_uv, u_resolution, vec2(1.0, 0.0), u_radius);`,
    // Pass 1: Vertical (reads output of Pass 0)
    `fragColor = blurAxis(u_src, v_uv, u_resolution, vec2(0.0, 1.0), u_radius);`,
  ],
};
```

### Feedback Effects (Temporal Loops)

Set `feedback: true`. The previous frame's result for this specific node will be bound to `u_prev`:
```ts
export const trails: EffectDef = {
  id: 'trails',
  feedback: true,
  animated: true,
  // ...
  fragment: `
  vec4 curr = texture(u_src, v_uv);
  vec4 past = texture(u_prev, v_uv);
  fragColor = max(curr, past * u_decay);
  `,
};
```

### Secondary Inputs (Multi-Texture Effects)

Declare `inputs: [{ key: 'mask', label: 'Mask' }]`. It exposes an extra input handle on the node and declares `uniform sampler2D u_mask;`. Unconnected inputs safely sample transparent black `vec4(0.0)`.

---

## 6. Guide: Working with Modulators

Modulators (`src/engine/modulators.ts`) generate numeric values to drive parameters over time:
- **Sources** (e.g. `lfo`, `noise`, `envelope`): Pure functions of time, rate, and seed.
- **Operators** (e.g. `math`, `mapRange`, `smooth`): Combine or scale incoming signals.

```ts
export type ModulatorDef = {
  id: string;
  label: string;
  role: 'source' | 'operator';
  params: ParamSpec[];
  sample: (params: Record<string, ParamValue>, time: number, seed: number) => number;
  moving: (params: Record<string, ParamValue>) => boolean;
  bounds: (ranges: Record<string, Interval | null>, params: Record<string, ParamValue>) => Interval | null;
  derive?: (params: Record<string, ParamValue>, inputs: Record<string, Interval | null>) => Record<string, number>;
};
```

Modulator edges connect a source's `mod` handle to a target's `param:<key>` handle. In `pipeline.ts`, before setting uniforms, `pass.modulation[key]` is evaluated and overrides the slider value.

---

## 7. React Flow & Node Conventions

- **Node Types**:
  - Image: `image`
  - Video: `video`
  - Effect: `effect`
  - Modulator: `modulator`
  - Viewer: `renderOutput` (**Must be `renderOutput`, not `output`**, to prevent React Flow default stylesheet collision)
  - Background: `backgroundOutput`
  - Offscreen Render: `render` / `formatter`
  - File Export: `export`

- **Port & Handle Typing**:
  - Main image streams: Default/null handle ID (blue wire).
  - Extra effect inputs: Named by `input.key` (blue wire).
  - Modulator output: `MOD_OUTPUT` = `'mod'` (amber wire).
  - Param input: `param:<key>` (amber wire).
  - Render asset streams: `RENDER_PORT` = `'render'` (purple wire).
  - `isValidConnection()` in `App.tsx` prevents cross-wiring invalid port combinations.

- **Full-Bleed Canvas & UI Layout**:
  - The canvas spans full bleed behind the UI.
  - CSS variables `--render-width` and `--gutter` in `glass.css` align with `fitViewOptions` padding in `App.tsx`.

---

## 8. Development & Verification Workflow

### 8.1. Running Scripts

```bash
# Run local dev server with HMR
npm run dev

# Run Vitest test suite
npm test

# Run Vitest in watch mode
npm run test:watch

# Validate all shaders offline against GLSL ES 3.00 reserved words & syntax
npm run check:shaders

# Full build (TypeScript typecheck + shader check + Vite production bundle)
npm run build
```

### 8.2. Pre-Commit / Pre-Completion Verification Checklist

Before finishing any task, an AI assistant **must ensure**:

1. **TypeScript Typecheck**:
   `npx tsc -b` passes without errors.
2. **Shader Validation**:
   `npm run check:shaders` outputs `shaders ok — N pass(es) checked` with 0 failures.
3. **Unit Tests**:
   `npm test` passes all tests.
4. **No Heavy Objects in Zustand**:
   No `ImageBitmap`, `HTMLVideoElement`, or `WebGLTexture` placed in `useGraph` store.
5. **No Collisions with Reserved Names**:
   Check new effect parameters or local GLSL variables against reserved lists.
6. **No Breaking Document Persistence**:
   Ensure state schema changes maintain backward compatibility in `document.ts` (handle missing optional fields cleanly).

---

## 9. Common Traps & Gotchas

1. **Texture Flip Inversion**:
   - `ImageBitmap` decodes are flipped at decode time (`imageStore.decodeImage`) because `UNPACK_FLIP_Y_WEBGL` is ignored on `ImageBitmap` sources by modern browsers. Video textures set `UNPACK_FLIP_Y_WEBGL` on upload.
2. **Animation Loop Freezes**:
   - If an effect uses `u_time`, make sure `animated: true` (or a dynamic function) is defined in `EffectDef`. Otherwise, the viewer stops redrawing when the user stops dragging sliders.
3. **Loop Detection in Graphs**:
   - Graph resolution detects cycles using the `Loop` error in `graph.ts`. Don't bypass cycle checks when modifying node traversal.
4. **Working Resolution vs Display Resolution**:
   - Effects execute inside `TargetPool` buffers capped at `MAX_WORKING_SIZE` (2048px). The final blit pass scales the result into the display canvas with aspect fit and bilinear/mipmapped filtering.
5. **Deployment**:
   - Deploys are fully automated via GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`.
   - The custom domain is retained via `public/CNAME`.
