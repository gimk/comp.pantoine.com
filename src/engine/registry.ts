import type { EffectDef } from './effects';
import { blackwhite } from './modules/blackwhite';
import { blend } from './modules/blend';
import { bloom } from './modules/bloom';
import { blur } from './modules/blur';
import { chromaBleed } from './modules/chromaBleed';
import { chromaticAberration } from './modules/chromaticAberration';
import { directionalBlur } from './modules/directionalBlur';
import { displace } from './modules/displace';
import { dropouts } from './modules/dropouts';
import { echo } from './modules/echo';
import { gradientMap } from './modules/gradientMap';
import { grain } from './modules/grain';
import { headSwitch } from './modules/headSwitch';
import { humBar } from './modules/humBar';
import { interlace } from './modules/interlace';
import { lens } from './modules/lens';
import { levels } from './modules/levels';
import { lineJitter } from './modules/lineJitter';
import { posterize } from './modules/posterize';
import { roll } from './modules/roll';
import { saturation } from './modules/saturation';
import { scanlines } from './modules/scanlines';
import { shadowMask } from './modules/shadowMask';
import { threshold } from './modules/threshold';
import { trails } from './modules/trails';
import { transform } from './modules/transform';
import { vignette } from './modules/vignette';
import { wobble } from './modules/wobble';

/**
 * Every effect the app knows about. Add one here and it appears in the UI,
 * filed under its own category.
 *
 * Ordered within a category by how often it is reached for, not
 * alphabetically -- the menu is something to pick from, not to look up in.
 */
export const registry: EffectDef[] = [
  // Color & Tone
  levels,
  saturation,
  blackwhite,

  // Stylize
  gradientMap,
  posterize,
  threshold,

  // Optics & Blur
  blur,
  directionalBlur,
  bloom,
  lens,
  chromaticAberration,
  vignette,

  // Transform & Warp
  transform,
  wobble,
  displace,

  // CRT & Display
  scanlines,
  shadowMask,
  interlace,
  roll,

  // Tape & Glitch
  headSwitch,
  humBar,
  lineJitter,
  dropouts,
  chromaBleed,

  // Noise & Grain
  grain,

  // Temporal
  trails,
  echo,

  // Composite
  blend,
];

const byId = new Map(registry.map((def) => [def.id, def]));

export const getEffect = (id: string): EffectDef | undefined => byId.get(id);
