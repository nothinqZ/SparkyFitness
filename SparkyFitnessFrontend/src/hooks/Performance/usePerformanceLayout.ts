import { useCallback, useState } from 'react';

export const PERFORMANCE_SECTIONS = [
  'insights',
  'overview',
  'compare',
  'running',
  'strength',
  'load',
  'recovery',
  'nutrition',
  'body',
] as const;
export type PerformanceSection = (typeof PERFORMANCE_SECTIONS)[number];

export const PERFORMANCE_RANGES = [30, 90, 180, 365] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

export interface PerformanceLayout {
  hidden: PerformanceSection[];
  sidebarCollapsed: boolean;
  days: PerformanceRange;
}

const STORAGE_KEY = 'sparky.performance.layout.v1';
const DEFAULT_LAYOUT: PerformanceLayout = {
  hidden: [],
  sidebarCollapsed: false,
  days: 90,
};

function read(): PerformanceLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PerformanceLayout>;
    return {
      hidden: (parsed.hidden ?? []).filter((s): s is PerformanceSection =>
        (PERFORMANCE_SECTIONS as readonly string[]).includes(s)
      ),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      days: (PERFORMANCE_RANGES as readonly number[]).includes(
        parsed.days as number
      )
        ? (parsed.days as PerformanceRange)
        : DEFAULT_LAYOUT.days,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * Dashboard preferences for this browser: hidden sections, sidebar state and
 * range. Storage failures (private mode, blocked site data) fall back to the
 * defaults instead of breaking the page.
 */
export function usePerformanceLayout() {
  const [layout, setLayout] = useState<PerformanceLayout>(read);
  const update = useCallback((patch: Partial<PerformanceLayout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not persisted; the in-memory state still applies.
      }
      return next;
    });
  }, []);
  const toggleSection = useCallback(
    (section: PerformanceSection) =>
      setLayout((prev) => {
        const hidden = prev.hidden.includes(section)
          ? prev.hidden.filter((s) => s !== section)
          : [...prev.hidden, section];
        const next = { ...prev, hidden };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      }),
    []
  );
  return { layout, update, toggleSection };
}
