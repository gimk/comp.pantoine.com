import type { EffectDef } from './effects';
import { generatorRegistry } from './generators';
import { blackwhite } from './modules/blackwhite';
import { blend } from './modules/blend';
import { blockGlitch } from './modules/blockGlitch';
import { pixelSort } from './modules/pixelSort';
import { bloom } from './modules/bloom';
import { sharpen } from './modules/sharpen';
import { tiltShift } from './modules/tiltShift';
import { godRays } from './modules/godRays';
import { lensFlare } from './modules/lensFlare';
import { bokeh } from './modules/bokeh';
import { blur } from './modules/blur';
import { chromaBleed } from './modules/chromaBleed';
import { chromaticAberration } from './modules/chromaticAberration';
import { chromaKey } from './modules/chromaKey';
import { colorBalance } from './modules/colorBalance';
import { selectiveColor } from './modules/selectiveColor';
import { channelMixer } from './modules/channelMixer';
import { curves } from './modules/curves';
import { directionalBlur } from './modules/directionalBlur';
import { displace } from './modules/displace';
import { dither } from './modules/dither';
import { dropouts } from './modules/dropouts';
import { echo } from './modules/echo';
import { flames } from './modules/flames';
import { fmScanlines } from './modules/fmScanlines';
import { edgeDetect } from './modules/edgeDetect';
import { emboss } from './modules/emboss';
import { crystalMosaic } from './modules/crystalMosaic';
import { exposure } from './modules/exposure';
import { gradientMap } from './modules/gradientMap';
import { grain } from './modules/grain';
import { halation } from './modules/halation';
import { halftone } from './modules/halftone';
import { headSwitch } from './modules/headSwitch';
import { humBar } from './modules/humBar';
import { interlace } from './modules/interlace';
import { invert } from './modules/invert';
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
import { shadowsHighlights } from './modules/shadowsHighlights';
import { streak } from './modules/streak';
import { subpixels } from './modules/subpixels';
import { swirl } from './modules/swirl';
import { polarCoordinates } from './modules/polarCoordinates';
import { ripple } from './modules/ripple';
import { cornerPin } from './modules/cornerPin';
import { tile } from './modules/tile';
import { kaleidoscope } from './modules/kaleidoscope';
import { threshold } from './modules/threshold';
import { timeMachine } from './modules/timeMachine';
import { trails } from './modules/trails';
import { frameHold } from './modules/frameHold';
import { motionDetect } from './modules/motionDetect';
import { datamosh } from './modules/datamosh';
import { feedback } from './modules/feedback';
import { transform } from './modules/transform';
import { velocityMod } from './modules/velocityMod';
import { vibrance } from './modules/vibrance';
import { vignette } from './modules/vignette';
import { whiteBalance } from './modules/whiteBalance';
import { wobble } from './modules/wobble';
import { resize } from './modules/resize';
import { signalRot } from './modules/signalRot';
import { iridescentMetal } from './modules/iridescentMetal';
import { glitchMachine } from './modules/glitchMachine';

/**
 * Every effect the app knows about. Add one here and it appears in the UI,
 * filed under its own category.
 *
 * The menu lists each category alphabetically (see paletteCatalog), so the
 * order here is free.
 */
export const registry: EffectDef[] = [
  // Color & Tone
  levels,
  curves,
  exposure,
  shadowsHighlights,
  saturation,
  vibrance,
  whiteBalance,
  colorBalance,
  selectiveColor,
  channelMixer,
  blackwhite,
  invert,

  // Stylize
  dither,
  pixelate,
  crystalMosaic,
  edgeDetect,
  emboss,
  halftone,
  gradientMap,
  iridescentMetal,
  posterize,
  threshold,

  // Optics & Blur
  sharpen,
  blur,
  bokeh,
  directionalBlur,
  radialBlur,
  tiltShift,
  bloom,
  godRays,
  lensFlare,
  halation,
  streak,
  lens,
  chromaticAberration,
  vignette,

  // Transform & Warp
  transform,
  resize,
  swirl,
  kaleidoscope,
  polarCoordinates,
  ripple,
  cornerPin,
  tile,
  wobble,
  displace,
  mapDisplace,

  // CRT & Display
  scanlines,
  shadowMask,
  subpixels,
  ruttEtra,
  velocityMod,
  fmScanlines,
  particleFlow,
  interlace,
  roll,

  // Tape & Glitch
  blockGlitch,
  pixelSort,
  glitchMachine,
  signalRot,
  headSwitch,
  humBar,
  lineJitter,
  dropouts,
  chromaBleed,

  // Noise & Grain
  grain,

  // Temporal
  trails,
  frameHold,
  motionDetect,
  datamosh,
  feedback,
  echo,
  timeMachine,
  flames,

  // Composite
  blend,
  mask,
  chromaKey,

  // Generators
  ...generatorRegistry,
];

const byId = new Map(registry.map((def) => [def.id, def]));

export const getEffect = (id: string): EffectDef | undefined => byId.get(id);
