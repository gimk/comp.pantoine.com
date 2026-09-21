import type { EffectDef } from './effects';
import { blackwhite } from './blackwhite';

/** Every effect the app knows about. Add one here and it appears in the UI. */
export const registry: EffectDef[] = [
  blackwhite,
];

const byId = new Map(registry.map((def) => [def.id, def]));

export const getEffect = (id: string): EffectDef | undefined => byId.get(id);
