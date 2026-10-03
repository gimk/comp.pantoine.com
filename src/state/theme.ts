import { create } from 'zustand';

/*
 * Light or dark: follow the system, or pinned one way by the toggle.
 *
 * A preference of this screen, not of the project -- kept in its own
 * storage key, never in the document. Applied as `data-theme` on the root,
 * which is all the stylesheet looks at. index.html sets the same attribute
 * from the same key before first paint, so a dark screen never flashes
 * light while the bundle loads; keep the two in step.
 */

const STORAGE_KEY = 'comp.theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

/** Order the toggle steps through. */
const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const readPreference = (storage: ThemeStorage | undefined): ThemePreference => {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
};

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

const browserStorage = (): ThemeStorage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const darkQuery = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)');

type ThemeState = {
  preference: ThemePreference;
  /** What is on screen: the preference, with System worked out. */
  theme: Theme;
  cycle: () => void;
};

const apply = (theme: Theme) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
};

const initialPreference = readPreference(browserStorage());
const initialTheme = resolveTheme(initialPreference, darkQuery?.matches ?? false);
apply(initialTheme);

export const useTheme = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  theme: initialTheme,
  cycle: () => {
    const preference = NEXT[get().preference];
    try {
      browserStorage()?.setItem(STORAGE_KEY, preference);
    } catch {
      // Private windows refuse storage; the choice lasts until reload.
    }
    const theme = resolveTheme(preference, darkQuery?.matches ?? false);
    apply(theme);
    set({ preference, theme });
  },
}));

// The system flipping (sunset, a settings change) moves a screen that follows it.
darkQuery?.addEventListener('change', (event) => {
  const { preference } = useTheme.getState();
  if (preference !== 'system') return;
  const theme = resolveTheme(preference, event.matches);
  apply(theme);
  useTheme.setState({ theme });
});
