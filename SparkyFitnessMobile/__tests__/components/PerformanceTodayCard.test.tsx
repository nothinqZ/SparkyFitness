import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { PerformanceOverviewResponse } from '@workspace/shared';

import PerformanceTodayCard from '../../src/components/PerformanceTodayCard';
import { usePerformanceOverview } from '../../src/hooks/usePerformance';
import { initializeI18n } from '../../src/localization/i18n';

jest.mock('../../src/hooks/usePerformance', () => ({
  usePerformanceOverview: jest.fn(),
}));

const base = {
  range: { start: '2026-09-21', end: '2026-10-20', timezone: 'UTC' },
  today: {
    date: '2026-10-20',
    bodyBatteryHighest: 88,
    bodyBatteryLowest: 21,
    bodyBatteryCharged: 64,
    bodyBatteryDrained: 70,
    avgStress: 31,
    steps: 8412,
    stepGoal: 10000,
    restingHr: 52,
    trainingReadiness: 71,
    recoveryTimeHours: 14,
    sleepHours: 7.25,
    sleepScore: 82,
  },
  load: {
    estimated: [],
    device: [],
    current: { ratio: 1.1, zone: 'optimal', provenance: 'device' },
  },
  recovery: {
    hrv: {
      series: [],
      status: {
        recent: 58,
        baseline: 60,
        baselineStdDev: 4,
        zScore: -0.5,
        status: 'within',
      },
    },
    restingHr: {
      series: [],
      status: {
        recent: 52,
        baseline: 52,
        baselineStdDev: 1,
        zScore: 0,
        status: 'within',
      },
    },
    sleep: {
      series: [],
      nights: 30,
      bedtimeStdDevMinutes: 20,
      meanBedtimeMinutes: 1380,
      avgSleepHours: 7.4,
    },
    readiness: {
      estimated: { score: 76, components: { hrv: 40, sleep: 91 } },
      device: 71,
    },
  },
} as unknown as PerformanceOverviewResponse;

const mockData = (data: PerformanceOverviewResponse) =>
  jest.mocked(usePerformanceOverview).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } as never);

describe('PerformanceTodayCard', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  it("shows readiness, guidance and Garmin's day summary", () => {
    mockData(base);
    const screen = render(<PerformanceTodayCard onPress={jest.fn()} />);
    expect(screen.getByText('76')).toBeTruthy();
    expect(
      screen.getByText(
        'Good conditions for a planned session. Listen to your body.'
      )
    ).toBeTruthy();
    expect(screen.getByTestId('performance-day-stats')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getByText('low 21')).toBeTruthy();
    expect(screen.getByText('8,412')).toBeTruthy();
    expect(screen.getByText('of 10,000')).toBeTruthy();
    expect(screen.getByText('14 h')).toBeTruthy();
  });

  it('advises recovery when load is very high', () => {
    mockData({
      ...base,
      load: {
        ...base.load,
        current: { ratio: 1.7, zone: 'very_high', provenance: 'device' },
      },
    });
    const screen = render(<PerformanceTodayCard onPress={jest.fn()} />);
    expect(
      screen.getByText(
        'Take it easier today. Recovery or recent load calls for caution.'
      )
    ).toBeTruthy();
  });

  it('hides the day summary without wearable data and opens the cockpit on press', () => {
    mockData({ ...base, today: null });
    const onPress = jest.fn();
    const screen = render(<PerformanceTodayCard onPress={onPress} />);
    expect(screen.queryByTestId('performance-day-stats')).toBeNull();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });
});
