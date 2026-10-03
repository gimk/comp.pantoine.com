import { describe, expect, it } from 'vitest';
import { contextKey, hintsFor, type HintContext } from './shortcutHints';

const labels = (context: HintContext) => hintsFor(context).map((hint) => hint.label);

describe('hintsFor', () => {
  it('offers ways in on an empty selection', () => {
    expect(labels({ kind: 'selection', count: 0, group: false })).toContain('Quick add');
  });

  it('offers grouping for several modules, ungrouping for one group', () => {
    expect(labels({ kind: 'selection', count: 3, group: false })).toContain('Group');
    expect(labels({ kind: 'selection', count: 1, group: true })).toContain('Ungroup');
    expect(labels({ kind: 'selection', count: 1, group: false })).not.toContain('Group');
  });

  it('marks the modifiers that act while held', () => {
    for (const kind of ['drag', 'scrub'] as const) {
      expect(hintsFor({ kind }).every((hint) => hint.held)).toBe(true);
    }
  });

  it('keeps each context to a glance', () => {
    const contexts: HintContext[] = [
      { kind: 'scrub' },
      { kind: 'wire' },
      { kind: 'drag' },
      { kind: 'selection', count: 0, group: false },
      { kind: 'selection', count: 1, group: false },
      { kind: 'selection', count: 1, group: true },
      { kind: 'selection', count: 4, group: true },
    ];
    for (const context of contexts) expect(hintsFor(context).length).toBeLessThanOrEqual(5);
  });
});

describe('contextKey', () => {
  it('changes only when the hints would', () => {
    expect(contextKey({ kind: 'selection', count: 2, group: false })).toBe(
      contextKey({ kind: 'selection', count: 5, group: true }),
    );
    expect(contextKey({ kind: 'selection', count: 1, group: false })).not.toBe(
      contextKey({ kind: 'selection', count: 1, group: true }),
    );
  });
});
