import { create } from 'zustand';

/*
 * The welcome tour: shown on a first visit, and again from Shortcuts & info.
 *
 * "Seen" is stored as a version rather than a flag, so a rewritten tour can
 * be shown again to everyone by bumping WELCOME_VERSION.
 */

const STORAGE_KEY = 'comp.welcomeSeen';
export const WELCOME_VERSION = '1';

type WelcomeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Whether this visitor still has to see the tour. Storage that throws
 * counts as not seen: a tour too many beats a newcomer left with none.
 */
export const shouldShowWelcome = (storage: WelcomeStorage | undefined): boolean => {
  try {
    return storage?.getItem(STORAGE_KEY) !== WELCOME_VERSION;
  } catch {
    return true;
  }
};

export const markWelcomeSeen = (storage: WelcomeStorage | undefined): void => {
  try {
    storage?.setItem(STORAGE_KEY, WELCOME_VERSION);
  } catch {
    // Private windows refuse storage; the tour will just come back next visit.
  }
};

const browserStorage = (): WelcomeStorage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

type WelcomeState = {
  isOpen: boolean;
  open: () => void;
  /** Skipped or finished alike: either way it has been seen. */
  close: () => void;
};

export const useWelcome = create<WelcomeState>((set) => ({
  isOpen: shouldShowWelcome(browserStorage()),
  open: () => set({ isOpen: true }),
  close: () => {
    markWelcomeSeen(browserStorage());
    set({ isOpen: false });
  },
}));
