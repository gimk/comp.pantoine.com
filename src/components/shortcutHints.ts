import { ALT, MOD } from './shortcutList';

/*
 * Which shortcuts the hint bar offers, given what is going on. A handful at
 * a time, and only the ones that act on what is in hand: the full list is
 * in Shortcuts & info, and the bar is there to make that list unnecessary
 * one situation at a time.
 *
 * Like shortcutList, kept by hand alongside the bindings themselves.
 */

/** A key that can be held mid-gesture, so the bar can show it pressed. */
export type HeldKey = 'shift' | 'ctrl' | 'alt';

export interface Hint {
  /** Keys pressed together. */
  keys: string[];
  label: string;
  /** For a modifier that changes a gesture while held. */
  held?: HeldKey;
}

export type HintContext =
  | { kind: 'scrub' }
  | { kind: 'wire' }
  | { kind: 'drag' }
  | { kind: 'selection'; count: number; group: boolean };

export const hintsFor = (context: HintContext): Hint[] => {
  switch (context.kind) {
    case 'scrub':
      return [
        { keys: ['Shift'], label: 'Faster', held: 'shift' },
        { keys: [ALT], label: 'Finer', held: 'alt' },
      ];
    case 'wire':
      return [{ keys: ['Shift', 'A'], label: 'Quick add on this wire' }];
    case 'drag':
      return [
        { keys: ['Shift'], label: 'Snap', held: 'shift' },
        // Ctrl on a Mac too: Cmd is the selection key there.
        { keys: ['Ctrl'], label: 'Lift out of chain', held: 'ctrl' },
        { keys: [ALT], label: 'Leave a copy', held: 'alt' },
      ];
    case 'selection':
      if (context.count === 0) {
        return [
          { keys: ['Shift', 'A'], label: 'Quick add' },
          { keys: ['Space'], label: 'Play' },
          { keys: ['F'], label: 'Fit all' },
          { keys: [MOD, 'Z'], label: 'Undo' },
        ];
      }
      if (context.group && context.count === 1) {
        return [
          { keys: [MOD, 'Shift', 'G'], label: 'Ungroup' },
          { keys: [MOD, 'S'], label: 'Save preset' },
          { keys: ['F'], label: 'Fit' },
          { keys: ['Del'], label: 'Delete' },
        ];
      }
      if (context.count > 1) {
        return [
          { keys: [MOD, 'G'], label: 'Group' },
          { keys: [MOD, 'S'], label: 'Save preset' },
          { keys: [MOD, 'D'], label: 'Duplicate' },
          { keys: ['Del'], label: 'Delete' },
        ];
      }
      return [
        { keys: [MOD, 'D'], label: 'Duplicate' },
        { keys: [MOD, 'C'], label: 'Copy' },
        { keys: ['F'], label: 'Fit' },
        { keys: ['Del'], label: 'Delete' },
        { keys: ['Esc'], label: 'Deselect' },
      ];
  }
};

/** A stable name for the context, so the bar can fade between them. */
export const contextKey = (context: HintContext): string =>
  context.kind === 'selection'
    ? `selection-${context.count === 0 ? 'none' : context.group && context.count === 1 ? 'group' : context.count > 1 ? 'many' : 'one'}`
    : context.kind;
