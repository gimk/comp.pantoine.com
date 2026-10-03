import type { EffectDef } from './effects';
import { ramp } from './modules/ramp';
import { noiseGenerator } from './modules/noiseGenerator';
import { plasma } from './modules/plasma';
import { cellular } from './modules/cellular';
import { pattern } from './modules/pattern';

export type ResolutionPreset = {
  label: string;
  width: number;
  height: number;
};

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: '720p HD (1280×720)', width: 1280, height: 720 },
  { label: '1080p FHD (1920×1080)', width: 1920, height: 1080 },
  { label: 'Square (1080×1080)', width: 1080, height: 1080 },
  { label: 'Vertical (1080×1920)', width: 1080, height: 1920 },
  { label: '4K UHD (3840×2160)', width: 3840, height: 2160 },
];

export const generatorRegistry: EffectDef[] = [
  ramp,
  noiseGenerator,
  plasma,
  cellular,
  pattern,
];

const byId = new Map(generatorRegistry.map((def) => [def.id, def]));

export const getGenerator = (id: string): EffectDef | undefined => byId.get(id);
