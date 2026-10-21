import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  InsightsReportResponse,
  InsightsTodayResponse,
  PerformanceOverviewResponse,
} from '@workspace/shared';
import {
  CompareCard,
  ReportCard,
  TodayInsightsCard,
} from '@/pages/Performance/InsightsSections';
import { formatDelta, normalizeSeries } from '@/utils/insightText';
import {
  useInsightsReport,
  useInsightsToday,
} from '@/hooks/Performance/useInsights';

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
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
jest.mock('@/hooks/Performance/useInsights', () => ({
  useInsightsToday: jest.fn(),
  useInsightsReport: jest.fn(),
}));

const shortDate = (d: string) => d;

const today: InsightsTodayResponse = {
  asOf: '2026-10-21',
  dataThrough: '2026-10-20',
  findings: [
    {
      id: 'recovery.hrv_low',
      area: 'recovery',
      kind: 'observation',
      severity: 'notice',
      tone: 'caution',
      params: { hrv: 41.25, hrvBaseline: 55 },
      evidence: [
        {
          metric: 'hrv',
          value: 41.25,
          unit: 'ms',
          period: '7d',
          source: 'device',
        },
      ],
      confidence: 'medium',
    },
  ],
  missing: ['protein'],
  readiness: { estimated: 50, components: {}, device: null },
  summary: { text: 'Keep it light.', source: 'ai' },
};

const totals = {
  strengthDays: 3,
  strengthSets: 42,
  strengthVolumeKg: 9800,
  runs: 2,
  runDistanceKm: 12.4,
  avgSleepHours: 7.2,
  avgHrv: 52,
  avgRestingHr: 50,
  avgCalories: 2400,
  avgProtein: null,
  nutritionDays: 0,
  weightStart: 80,
  weightEnd: 79.6,
};
const report: InsightsReportResponse = {
  period: 'week',
  start: '2026-10-12',
  end: '2026-10-18',
  totals,
  previous: { ...totals, strengthDays: 2 },
  bests: [{ exercise: 'Deadlift', e1rmKg: 180.5, date: '2026-10-15' }],
  findings: [],
  missing: [],
};

const ok = <T,>(data: T) =>
  ({ data, isLoading: false, isError: false }) as never;

function overview(opts: {
  sleep?: number[];
  hrv?: number[];
}): PerformanceOverviewResponse {
  const series = (values: number[] = []) =>
    values.map((value, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      value,
    }));
  return {
    recovery: {
      hrv: { series: series(opts.hrv), status: {} },
      restingHr: { series: [], status: {} },
      sleep: {
        series: series(opts.sleep).map((p) => ({
          date: p.date,
          hours: p.value,
        })),
      },
    },
    body: { weight: [], weightAverage7d: [], trendKgPerWeek: null },
    nutrition: { daily: [], averages: {} },
    load: { estimated: [], device: [], current: null },
    strength: { weekly: [], topLifts: [] },
    running: { weekly: [], vo2max: [] },
  } as unknown as PerformanceOverviewResponse;
}

describe('TodayInsightsCard', () => {
  it('shows findings with evidence, the labelled AI summary and missing signals', () => {
    jest.mocked(useInsightsToday).mockReturnValue(ok(today));
    render(<TodayInsightsCard shortDate={shortDate} />);
    expect(screen.getByText('HRV below your normal range')).toBeInTheDocument();
    expect(
      screen.getByText('7-day average 41.25 ms, usually 55 ms.')
    ).toBeInTheDocument();
    expect(screen.getByText('HRV 41.25 ms · 7d · Garmin')).toBeInTheDocument();
    expect(screen.getByText('Keep it light.')).toBeInTheDocument();
    expect(
      screen.getByText('Worded by your AI service from the findings above')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Not enough recent data for: Protein')
    ).toBeInTheDocument();
    expect(screen.getByText('Data through 2026-10-20')).toBeInTheDocument();
  });

  it('says when nothing stands out', () => {
    jest
      .mocked(useInsightsToday)
      .mockReturnValue(
        ok({ ...today, findings: [], summary: null, missing: [] })
      );
    render(<TodayInsightsCard shortDate={shortDate} />);
    expect(
      screen.getByText(
        'Nothing stands out. Your recent data looks unremarkable.'
      )
    ).toBeInTheDocument();
  });
});

describe('ReportCard', () => {
  it('shows totals with deltas and switches to the month', () => {
    jest.mocked(useInsightsReport).mockReturnValue(ok(report));
    render(<ReportCard shortDate={shortDate} />);
    expect(useInsightsReport).toHaveBeenLastCalledWith('week');
    expect(screen.getByText('(+1)')).toBeInTheDocument();
    expect(screen.getByText('-0.4 kg')).toBeInTheDocument();
    expect(screen.getByText('180.5 kg · 2026-10-15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(useInsightsReport).toHaveBeenLastCalledWith('month');
  });
});

describe('helpers', () => {
  it('formats deltas', () => {
    expect(formatDelta(3, 2, 0, 'en')).toBe('(+1)');
    expect(formatDelta(2, 2, 0, 'en')).toBe('(±0)');
    expect(formatDelta(1.25, 2, 1, 'de')).toBe('(-0,8)');
    expect(formatDelta(null, 2, 0, 'en')).toBe('');
  });

  it('normalizes series to 0–100', () => {
    expect(normalizeSeries([10, null, 20, 15])).toEqual([0, null, 100, 50]);
    expect(normalizeSeries([4, 4])).toEqual([50, 50]);
  });
});

describe('CompareCard', () => {
  it('reports a strong link from enough pairs', () => {
    const sleep = [6, 7, 8, 6.5, 7.5, 8.5, 6, 7, 8, 7];
    render(
      <CompareCard
        data={overview({ sleep, hrv: sleep.map((h) => h * 10) })}
        shortDate={shortDate}
      />
    );
    expect(screen.getByTestId('compare-result')).toHaveTextContent(
      'Strongly linked, moving in the same direction (r = 1, 10 days)'
    );
    expect(screen.getByLabelText('First metric')).toHaveValue('sleepHours');
    expect(screen.getByLabelText('Second metric')).toHaveValue('hrv');
  });

  it('withholds the correlation below the minimum pairs', () => {
    render(
      <CompareCard
        data={overview({ sleep: [6, 7, 8], hrv: [50, 60, 70] })}
        shortDate={shortDate}
      />
    );
    expect(screen.getByTestId('compare-result')).toHaveTextContent(
      '3 of 8 days with both values; too few to judge a link.'
    );
  });

  it('shows an empty card with fewer than two metrics', () => {
    render(
      <CompareCard data={overview({ sleep: [7, 8] })} shortDate={shortDate} />
    );
    expect(screen.getByText('No data in this range')).toBeInTheDocument();
  });
});
