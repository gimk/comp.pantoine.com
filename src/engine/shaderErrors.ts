/**
 * Shaders that would not compile, and why.
 *
 * The pipeline discovers these mid-frame, inside a render loop that knows
 * nothing about React. This is the seam between the two: the pipeline
 * reports, components subscribe, and neither has to reach into the other.
 *
 * Without it a broken module is invisible -- the pass falls through to the
 * pass-through program and the node sits there looking fine while doing
 * nothing at all, which is a worse failure than a crash.
 */

const errors = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * Record a compile failure. Repeats are ignored so the render loop can call
 * this every frame without waking React each time.
 */
export const reportShaderError = (effectId: string, message: string): void => {
  if (errors.get(effectId) === message) return;
  errors.set(effectId, message);
  for (const listener of listeners) listener();
};

export const getShaderError = (effectId: string): string | undefined => errors.get(effectId);

export const subscribeShaderErrors = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
