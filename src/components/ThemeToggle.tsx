import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../state/theme';

const ICONS: Record<ThemePreference, React.ReactNode> = {
  system: <Monitor size={14} aria-hidden="true" />,
  light: <Sun size={14} aria-hidden="true" />,
  dark: <Moon size={14} aria-hidden="true" />,
};

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: follows the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

/**
 * One button stepping System, Light, Dark. It shows the preference rather
 * than what is on screen, so System still reads as System whichever way the
 * system happens to be set.
 */
export const ThemeToggle: React.FC = () => {
  const preference = useTheme((state) => state.preference);
  const cycle = useTheme((state) => state.cycle);
  return (
    <button
      type="button"
      className="toolbar-button toolbar-icon-button"
      onClick={cycle}
      title={`${LABELS[preference]} · click to change`}
      aria-label={LABELS[preference]}
    >
      {ICONS[preference]}
    </button>
  );
};
