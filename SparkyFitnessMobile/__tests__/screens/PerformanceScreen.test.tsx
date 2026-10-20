import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { PerformanceOverviewResponse } from '@workspace/shared';

import PerformanceScreen from '../../src/screens/PerformanceScreen';
import {
  usePerformanceOverview,
  useWatchSyncStatus,
} from '../../src/hooks/usePerformance';
import { initializeI18n } from '../../src/localization/i18n';
import type { RootStackScreenProps } from '../../src/types/navigation';

jest.mock('../../src/hooks/usePerformance', () => ({
  usePerformanceOverview: jest.fn(),
  useWatchSyncStatus: jest.fn(),
}));
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: () => ({
    preferences: { default_weight_unit: 'kg', default_distance_unit: 'km' },
  }),
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

const overview: PerformanceOverviewResponse = {
  range: { start: '2026-07-23', end: '2026-10-20', timezone: 'UTC' },
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
    trainingReadiness: 64,
    recoveryTimeHours: 14,
    sleepHours: 7.25,
    sleepScore: 82,
  },
  running: {
    provenance: 'measured',
    totals: { runs: 4, distanceKm: 25, durationMinutes: 126 },
    weekly: [],
    runs: [],
    predictions: {
      estimated: {
        '5k': 1439,
        '10k': 3000,
        half_marathon: 6619,
        marathon: 13801,
      },
      device: { '5k': 1260, '10k': null, half_marathon: null, marathon: 12000 },
      deviceDate: '2026-10-20',
    },
    vo2max: [{ date: '2026-10-20', value: 52 }],
  },
  strength: {
    provenance: 'estimated',
    weekly: [],
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
    estimated: [],
    device: [],
    current: { ratio: 1.6, zone: 'very_high', provenance: 'device' },
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
        recent: 58,
        baseline: 50.5,
        baselineStdDev: 0.5,
        zScore: 15,
        status: 'above',
      },
    },
    sleep: {
      series: [],
      nights: 30,
      bedtimeStdDevMinutes: 12,
      meanBedtimeMinutes: 1380,
      avgSleepHours: 7.5,
    },
    readiness: {
      estimated: {
        score: 33,
        components: { hrv: 0, restingHr: 0, sleep: 94, load: 57 },
      },
      device: 64,
    },
  },
  nutrition: {
    daily: [],
    averages: { days: 3, calories: 2450, protein: 160, carbs: 250, fat: 80 },
  },
  body: { weight: [], weightAverage7d: [], trendKgPerWeek: -0.7 },
};

const props = {
  navigation: { navigate: jest.fn() },
  route: { key: 'Performance', name: 'Performance' },
} as unknown as RootStackScreenProps<'Performance'>;

describe('PerformanceScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    jest.mocked(usePerformanceOverview).mockReturnValue({
      data: overview,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    jest.mocked(useWatchSyncStatus).mockReturnValue({
      data: {
        last_upload_at: '2026-10-20T07:00:00.000Z',
        sessions_total: 5,
        sessions_linked_to_garmin: 4,
        devices: [
          {
            device_id: 'dev-1',
            device_model: 'fenix7',
            app_version: '0.1.0',
            last_seen_at: '2026-10-20T07:00:00.000Z',
          },
        ],
      },
      isError: false,
    });
  });

  it('shows readiness, recovery, running and watch status', () => {
    const screen = render(<PerformanceScreen {...props} />);
    expect(screen.getByText('33')).toBeTruthy();
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('1.60 · Very high (> 1.5)')).toBeTruthy();
    expect(screen.getByText('45 ms · Below baseline')).toBeTruthy();
    expect(screen.getByText('58 bpm · Above baseline')).toBeTruthy();
    expect(screen.getByText('25.0 km · 4×')).toBeTruthy();
    expect(screen.getByText('5:02 /km')).toBeTruthy();
    expect(screen.getByText('3:20:00  ·  ~3:50:01')).toBeTruthy();
    expect(screen.getByText('116.7 kg')).toBeTruthy();
    expect(screen.getByText('-0.70 kg/wk')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('fenix7')).toBeTruthy();
  });

  it('requests the chosen range', () => {
    const screen = render(<PerformanceScreen {...props} />);
    fireEvent.press(screen.getByText('180d'));
    expect(usePerformanceOverview).toHaveBeenLastCalledWith(180);
  });

  it('explains how to pair when the server has no watch data', () => {
    jest
      .mocked(useWatchSyncStatus)
      .mockReturnValue({ data: undefined, isError: false });
    const screen = render(<PerformanceScreen {...props} />);
    expect(
      screen.getByText(
        'Pair the watch in SparkyFitness web: Settings > Garmin watch.'
      )
    ).toBeTruthy();
  });
});
