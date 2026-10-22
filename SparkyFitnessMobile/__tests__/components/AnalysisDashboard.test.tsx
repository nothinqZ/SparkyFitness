import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { PerformanceOverviewResponse } from '@workspace/shared';
import AnalysisDashboard from '../../src/components/AnalysisDashboard';
import { initializeI18n } from '../../src/localization/i18n';
import { useAppPreferencesStore } from '../../src/stores/appPreferencesStore';

const overview = {
  recovery: {
    hrv: { series: [{ date: '2026-10-20', value: 55 }] },
    restingHr: { series: [] },
    sleep: { series: [{ date: '2026-10-20', hours: 7 }] },
  },
  body: { weight: [], weightAverage7d: [] },
  nutrition: { daily: [] },
  load: { estimated: [], device: [] },
  strength: { weekly: [], topLifts: [] },
  running: { weekly: [], vo2max: [] },
} as unknown as PerformanceOverviewResponse;

describe('AnalysisDashboard', () => {
  beforeAll(async () => initializeI18n('en'));
  beforeEach(() =>
    useAppPreferencesStore.setState({ analysisComparisons: [] })
  );

  it('saves and removes a comparison for later visits', () => {
    const screen = render(<AnalysisDashboard overview={overview} />);
    fireEvent.press(screen.getByTestId('save-comparison'));
    expect(useAppPreferencesStore.getState().analysisComparisons).toEqual([
      { a: 'sleepHours', b: 'hrv' },
    ]);
    expect(screen.getByTestId('saved-comparison-sleepHours-hrv')).toBeTruthy();
    fireEvent.press(screen.getByText('Remove comparison'));
    expect(useAppPreferencesStore.getState().analysisComparisons).toEqual([]);
  });

  it('does not save duplicate metric pairs', () => {
    useAppPreferencesStore
      .getState()
      .addAnalysisComparison('hrv', 'sleepHours');
    useAppPreferencesStore
      .getState()
      .addAnalysisComparison('hrv', 'sleepHours');
    expect(useAppPreferencesStore.getState().analysisComparisons).toHaveLength(
      1
    );
  });

  it('keeps the four saved comparisons instead of replacing an older one', () => {
    const store = useAppPreferencesStore.getState();
    store.addAnalysisComparison('hrv', 'sleepHours');
    store.addAnalysisComparison('hrv', 'weight');
    store.addAnalysisComparison('hrv', 'protein');
    store.addAnalysisComparison('hrv', 'runDistance');
    store.addAnalysisComparison('hrv', 'vo2max');
    expect(useAppPreferencesStore.getState().analysisComparisons).toEqual([
      { a: 'hrv', b: 'sleepHours' },
      { a: 'hrv', b: 'weight' },
      { a: 'hrv', b: 'protein' },
      { a: 'hrv', b: 'runDistance' },
    ]);
  });
});
