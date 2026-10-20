import { useTheme } from '@/contexts/ThemeContext';

// Two categorical slots, validated for both themes (CVD and normal-vision
// separation, 3:1 against the surface). Text never uses them.
const SERIES = {
  light: { primary: '#2a78d6', secondary: '#eb6834' },
  dark: { primary: '#3987e5', secondary: '#d95926' },
} as const;

export function useSeriesColors() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? SERIES.dark : SERIES.light;
}
