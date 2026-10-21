import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { PerformanceOverviewResponse } from '@workspace/shared';

import CompareCard, { normalizeSeries } from '../../src/components/CompareCard';
import { initializeI18n } from '../../src/localization/i18n';

const days = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`
  );

/** Only the series compareMetrics reads; the rest of the overview is irrelevant here. */
function overview(opts: {
  hrv?: number[];
  sleep?: number[];
  weight?: number[];
}): PerformanceOverviewResponse {
  const series = (values: number[] = []) =>
    days(values.length).map((date, i) => ({ date, value: values[i]! }));
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
    body: {
      weight: series(opts.weight),
      weightAverage7d: [],
      trendKgPerWeek: null,
    },
    nutrition: { daily: [], averages: {} },
    load: { estimated: [], device: [], current: null },
    strength: { weekly: [], topLifts: [] },
    running: { weekly: [], vo2max: [] },
  } as unknown as PerformanceOverviewResponse;
}

describe('normalizeSeries', () => {
  it('scales to 0–100 and keeps gaps', () => {
    expect(normalizeSeries([10, null, 20, 15])).toEqual([0, null, 100, 50]);
  });
  it('puts a flat series in the middle', () => {
    expect(normalizeSeries([3, 3])).toEqual([50, 50]);
  });
  it('handles an empty series', () => {
    expect(normalizeSeries([null])).toEqual([null]);
  });
});

describe('CompareCard', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  it('defaults to sleep against HRV and reports a strong same-direction link', () => {
    const sleep = [6, 7, 8, 6.5, 7.5, 8.5, 6, 7, 8, 7];
    const hrv = sleep.map((h) => h * 10 + 1);
    const screen = render(<CompareCard overview={overview({ sleep, hrv })} />);
    expect(screen.getByTestId('compare-result').props.children).toBe(
      'Strongly linked, moving in the same direction (r = 1, 10 days)'
    );
    expect(
      screen.getByText(
        'Lines are scaled to their own range. A link is an observation, not a cause.'
      )
    ).toBeTruthy();
  });

  it('withholds a correlation below the minimum pairs', () => {
    const screen = render(
      <CompareCard
        overview={overview({ sleep: [6, 7, 8], hrv: [50, 60, 70] })}
      />
    );
    expect(screen.getByTestId('compare-result').props.children).toBe(
      '3 of 8 days with both values; too few to judge a link.'
    );
  });

  it('switches metric and reports an inverse link', () => {
    const sleep = [6, 7, 8, 6.5, 7.5, 8.5, 6, 7, 8, 7];
    const weight = sleep.map((h) => 90 - h);
    const screen = render(
      <CompareCard overview={overview({ sleep, hrv: sleep, weight })} />
    );
    fireEvent.press(screen.getByTestId('compare-b-weight'));
    expect(screen.getByTestId('compare-result').props.children).toBe(
      'Strongly linked, moving in opposite directions (r = -1, 10 days)'
    );
  });

  it('renders nothing with fewer than two metrics', () => {
    const screen = render(
      <CompareCard overview={overview({ sleep: [7, 8] })} />
    );
    expect(screen.queryByTestId('compare-card')).toBeNull();
  });
});
