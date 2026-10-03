import { describe, expect, it } from 'vitest';
import { WELCOME_VERSION, markWelcomeSeen, shouldShowWelcome } from './welcome';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};

const brokenStorage = {
  getItem: (): string | null => {
    throw new Error('denied');
  },
  setItem: (): void => {
    throw new Error('denied');
  },
};

describe('welcome tour', () => {
  it('shows on a first visit, and not once seen', () => {
    const storage = memoryStorage();
    expect(shouldShowWelcome(storage)).toBe(true);
    markWelcomeSeen(storage);
    expect(shouldShowWelcome(storage)).toBe(false);
  });

  it('shows again when the tour has been rewritten since', () => {
    const storage = memoryStorage();
    storage.map.set('comp.welcomeSeen', String(Number(WELCOME_VERSION) - 1));
    expect(shouldShowWelcome(storage)).toBe(true);
  });

  it('copes with storage that throws or is missing', () => {
    expect(shouldShowWelcome(brokenStorage)).toBe(true);
    expect(() => markWelcomeSeen(brokenStorage)).not.toThrow();
    expect(shouldShowWelcome(undefined)).toBe(true);
  });
});
