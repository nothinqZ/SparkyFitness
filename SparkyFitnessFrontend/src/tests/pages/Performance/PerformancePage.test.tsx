import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { PerformanceOverviewResponse } from '@workspace/shared';
import PerformancePage from '@/pages/Performance/PerformancePage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown, opts?: Record<string, unknown>) => {
      const template = typeof arg === 'string' ? arg : key;
      const vars = (typeof arg === 'object' ? arg : opts) as
        Record<string, unknown> | undefined;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
        String(vars?.[k] ?? '')
      );
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('@/hooks/Performance/useInsights', () => ({
  useInsightsToday: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
  }),
  useInsightsReport: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    distanceUnit: 'km',
    weightUnit: 'kg',
    convertWeight: (v: number) => v,
    formatDateInUserTimezone: (d: string) => d,
  }),
}));
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

const overview: PerformanceOverviewResponse = {
  range: { start: '2026-07-23', end: '2026-10-20', timezone: 'UTC' },
  today: null,
  running: {
    provenance: 'measured',
    totals: { runs: 2, distanceKm: 15, durationMinutes: 75 },
    weekly: [
      {
        weekStart: '2026-10-12',
        distanceKm: 15,
        runs: 2,
        durationMinutes: 75,
        avgPaceSecondsPerKm: 300,
      },
    ],
    runs: [],
    predictions: {
      estimated: {
        '5k': 1200,
        '10k': 2502,
        half_marathon: 5523,
        marathon: 11509,
      },
      device: { '5k': 1260, '10k': null, half_marathon: null, marathon: 12000 },
      deviceDate: '2026-10-20',
    },
    vo2max: [{ date: '2026-10-20', value: 52 }],
  },
  strength: {
    provenance: 'estimated',
    weekly: [{ weekStart: '2026-10-12', volumeKg: 1570, sets: 3 }],
    topLifts: [
      {
        exerciseId: null,
        exerciseName: 'Back Squat',
        bestE1rmKg: 116.7,
        bestDate: '2026-10-17',
        sets: 3,
        trend: [],
      },
    ],
  },
  load: {
    estimated: [{ date: '2026-10-20', acute: 30, chronic: 28, ratio: 1.07 }],
    device: [],
    current: { ratio: 1.07, zone: 'optimal', provenance: 'estimated' },
  },
  recovery: {
    hrv: {
      series: [],
      status: {
        recent: 45,
        baseline: 61,
        baselineStdDev: 1,
        zScore: -16,
        status: 'below',
      },
    },
    restingHr: {
      series: [],
      status: {
        recent: null,
        baseline: null,
        baselineStdDev: null,
        zScore: null,
        status: 'insufficient_data',
      },
    },
    sleep: {
      series: [],
      nights: 0,
      bedtimeStdDevMinutes: null,
      meanBedtimeMinutes: null,
      avgSleepHours: 7.5,
    },
    readiness: {
      estimated: { score: 42, components: { hrv: 0, sleep: 94 } },
      device: 64,
    },
  },
  nutrition: {
    daily: [],
    averages: {
      days: 0,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
    },
  },
  body: { weight: [], weightAverage7d: [], trendKgPerWeek: -0.7 },
};

jest.mock('@/hooks/Performance/usePerformanceOverview', () => ({
  usePerformanceOverview: () => ({
    data: overview,
    isLoading: false,
    isError: false,
  }),
}));

describe('PerformancePage', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows KPIs with provenance and status labels', () => {
    render(<PerformancePage />);
    expect(screen.getByText('15.0 km')).toBeInTheDocument();
    expect(screen.getByText('5:00 /km')).toBeInTheDocument();
    expect(screen.getByText('Optimal (0.8–1.3)')).toBeInTheDocument();
    expect(screen.getByText('Below baseline')).toBeInTheDocument();
    expect(screen.getByText('Garmin: 64')).toBeInTheDocument();
    expect(screen.getByText('-0.70 kg/wk')).toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Device').length).toBeGreaterThan(0);
  });

  it('lists Garmin and estimated race predictions side by side', () => {
    render(<PerformancePage />);
    const row = screen.getByText('Marathon').closest('tr')!;
    expect(within(row).getByText('3:20:00')).toBeInTheDocument();
    expect(within(row).getByText('3:11:49')).toBeInTheDocument();
  });

  it('hides a section and remembers it', () => {
    const { unmount } = render(<PerformancePage />);
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Strength' }));
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
    unmount();
    render(<PerformancePage />);
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show Strength' })
    ).toBeInTheDocument();
  });

  it('lists the insights and compare sections in the sidebar', () => {
    render(<PerformancePage />);
    expect(
      screen.getByRole('button', { name: 'Hide Insights' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide Compare' })
    ).toBeInTheDocument();
  });

  it('switches the range', () => {
    render(<PerformancePage />);
    const year = screen.getByRole('button', { name: '1 year' });
    fireEvent.click(year);
    expect(year).toHaveAttribute('aria-pressed', 'true');
  });
});
