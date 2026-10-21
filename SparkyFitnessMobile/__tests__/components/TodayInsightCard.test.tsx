import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { InsightsTodayResponse } from '@workspace/shared';

import TodayInsightCard from '../../src/components/TodayInsightCard';
import { useInsightsToday } from '../../src/hooks/useInsights';
import { initializeI18n } from '../../src/localization/i18n';

jest.mock('../../src/hooks/useInsights', () => ({
  useInsightsToday: jest.fn(),
}));

const today: InsightsTodayResponse = {
  asOf: '2026-10-21',
  dataThrough: '2026-10-20',
  findings: [
    {
      id: 'recovery.strained',
      area: 'recovery',
      kind: 'hypothesis',
      severity: 'warning',
      tone: 'caution',
      params: {
        hrv: 40,
        hrvBaseline: 55,
        restingHr: 58,
        restingHrBaseline: 51,
      },
      evidence: [],
      confidence: 'medium',
    },
    {
      id: 'sleep.short',
      area: 'sleep',
      kind: 'observation',
      severity: 'notice',
      tone: 'caution',
      params: { hours: 6.1, nights: 7 },
      evidence: [],
      confidence: 'high',
    },
  ],
  missing: [],
  readiness: { estimated: 41, components: {}, device: null },
  summary: { text: 'Take it easier today.', source: 'ai' },
};

const mockToday = (data: InsightsTodayResponse | undefined) =>
  jest.mocked(useInsightsToday).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } as never);

describe('TodayInsightCard', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  it('shows the top finding, more titles and the labelled AI summary', () => {
    mockToday(today);
    const onPress = jest.fn();
    const screen = render(<TodayInsightCard onPress={onPress} />);
    expect(screen.getByText('Recovery looks strained')).toBeTruthy();
    expect(screen.getByText('Possible')).toBeTruthy();
    expect(screen.getByText('Little sleep')).toBeTruthy();
    expect(screen.getByText('Take it easier today.')).toBeTruthy();
    expect(
      screen.getByText('Worded by your AI service from the findings above')
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-insight-card'));
    expect(onPress).toHaveBeenCalled();
  });

  it('renders nothing without findings', () => {
    mockToday({ ...today, findings: [], summary: null });
    const screen = render(<TodayInsightCard onPress={jest.fn()} />);
    expect(screen.queryByTestId('today-insight-card')).toBeNull();
  });

  it('renders nothing while loading', () => {
    mockToday(undefined);
    const screen = render(<TodayInsightCard onPress={jest.fn()} />);
    expect(screen.queryByTestId('today-insight-card')).toBeNull();
  });
});
