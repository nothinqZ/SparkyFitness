import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type {
  InsightsReportResponse,
  InsightsTodayResponse,
} from '@workspace/shared';

import InsightsScreen from '../../src/screens/InsightsScreen';
import {
  useInsightsReport,
  useInsightsToday,
} from '../../src/hooks/useInsights';
import { initializeI18n } from '../../src/localization/i18n';
import type { RootStackScreenProps } from '../../src/types/navigation';

jest.mock('../../src/hooks/useInsights', () => ({
  useInsightsToday: jest.fn(),
  useInsightsReport: jest.fn(),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const today: InsightsTodayResponse = {
  asOf: '2026-10-21',
  dataThrough: '2026-10-20',
  findings: [
    {
      id: 'load.high',
      area: 'load',
      kind: 'finding',
      severity: 'notice',
      tone: 'caution',
      params: { ratio: 1.38 },
      evidence: [
        {
          metric: 'loadRatio',
          value: 1.38,
          period: '7d/28d',
          source: 'device',
        },
      ],
      confidence: 'high',
    },
  ],
  missing: ['protein'],
  readiness: { estimated: 55, components: {}, device: 60 },
  summary: null,
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
  previous: {
    ...totals,
    strengthDays: 2,
    strengthSets: 30,
    runDistanceKm: 12.4,
  },
  bests: [{ exercise: 'Deadlift', e1rmKg: 180.5, date: '2026-10-15' }],
  findings: [],
  missing: [],
};

const props = {
  navigation: { navigate: jest.fn() },
  route: { key: 'Insights', name: 'Insights' },
} as unknown as RootStackScreenProps<'Insights'>;

describe('InsightsScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    jest.mocked(useInsightsToday).mockReturnValue({
      data: today,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    jest.mocked(useInsightsReport).mockReturnValue({
      data: report,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
  });

  it('shows findings with their evidence, confidence and missing signals', () => {
    const screen = render(<InsightsScreen {...props} />);
    expect(screen.getByText('Training load raised')).toBeTruthy();
    expect(screen.getByText('Measured')).toBeTruthy();
    expect(screen.getByText('high confidence')).toBeTruthy();
    expect(screen.getByText('Load ratio 1.38 · 7d/28d · Garmin')).toBeTruthy();
    expect(
      screen.getByText('Not enough recent data for: Protein')
    ).toBeTruthy();
  });

  it('shows the weekly report with deltas against the week before', () => {
    const screen = render(<InsightsScreen {...props} />);
    fireEvent.press(screen.getByText('Week'));
    expect(useInsightsReport).toHaveBeenLastCalledWith('week');
    expect(screen.getByText(/Strength days/)).toBeTruthy();
    expect(screen.getByText('  (+1)')).toBeTruthy();
    expect(screen.getByText('  (+12)')).toBeTruthy();
    expect(screen.getAllByText('  (±0)').length).toBeGreaterThan(0);
    expect(screen.getByText('-0.4 kg')).toBeTruthy();
    expect(screen.getByText('Deadlift')).toBeTruthy();
  });

  it('requests the monthly report', () => {
    const screen = render(<InsightsScreen {...props} />);
    fireEvent.press(screen.getByText('Month'));
    expect(useInsightsReport).toHaveBeenLastCalledWith('month');
  });

  it('offers a retry when loading fails', () => {
    const refetch = jest.fn();
    jest.mocked(useInsightsToday).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    const screen = render(<InsightsScreen {...props} />);
    expect(screen.getByText('Insights could not be loaded.')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
