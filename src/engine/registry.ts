import type { EffectDef } from './effects';
import { blackwhite } from './modules/blackwhite';
import { blend } from './modules/blend';
import { blockGlitch } from './modules/blockGlitch';
import { bloom } from './modules/bloom';
import { blur } from './modules/blur';
import { chromaBleed } from './modules/chromaBleed';
import { chromaticAberration } from './modules/chromaticAberration';
import { chromaKey } from './modules/chromaKey';
import { directionalBlur } from './modules/directionalBlur';
import { displace } from './modules/displace';
import { dither } from './modules/dither';
import { dropouts } from './modules/dropouts';
import { echo } from './modules/echo';
import { edgeDetect } from './modules/edgeDetect';
import { gradientMap } from './modules/gradientMap';
import { grain } from './modules/grain';
import { halation } from './modules/halation';
import { halftone } from './modules/halftone';
import { headSwitch } from './modules/headSwitch';
import { humBar } from './modules/humBar';
import { interlace } from './modules/interlace';
import { lens } from './modules/lens';
import { levels } from './modules/levels';
import { lineJitter } from './modules/lineJitter';
import { mapDisplace } from './modules/mapDisplace';
import { mask } from './modules/mask';
import { particleFlow } from './modules/particleFlow';
import { pixelate } from './modules/pixelate';
import { posterize } from './modules/posterize';
import { radialBlur } from './modules/radialBlur';
import { roll } from './modules/roll';
import { ruttEtra } from './modules/ruttEtra';
import { saturation } from './modules/saturation';
import { scanlines } from './modules/scanlines';
import { shadowMask } from './modules/shadowMask';
import { streak } from './modules/streak';
import { subpixels } from './modules/subpixels';
import { swirl } from './modules/swirl';
import { threshold } from './modules/threshold';
import { trails } from './modules/trails';
import { transform } from './modules/transform';
import { velocityMod } from './modules/velocityMod';
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
  dither,
  pixelate,
  edgeDetect,
  halftone,
  gradientMap,
  posterize,
  threshold,

  // Optics & Blur
  blur,
  directionalBlur,
  radialBlur,
  bloom,
  halation,
  streak,
  lens,
  chromaticAberration,
  vignette,

  // Transform & Warp
  transform,
  swirl,
  wobble,
  displace,
  mapDisplace,

  // CRT & Display
  scanlines,
  shadowMask,
  subpixels,
  ruttEtra,
  velocityMod,
  particleFlow,
  interlace,
  roll,

  // Tape & Glitch
  blockGlitch,
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
  mask,
  chromaKey,
];

const byId = new Map(registry.map((def) => [def.id, def]));

export const getEffect = (id: string): EffectDef | undefined => byId.get(id);
