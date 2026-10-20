import { describe, expect, it } from 'vitest';
import type { HealthMetricsRow } from '../models/performanceRepository.js';
import { buildToday } from '../services/performanceService.js';

const row = (date: string, extra: Partial<HealthMetricsRow> = {}) =>
  ({
    date,
    resting_heart_rate: 52,
    body_battery_highest: 88,
    body_battery_lowest: 21,
    body_battery_charged: 64,
    body_battery_drained: 70,
    avg_stress_level: 31,
    total_steps: 8412,
    step_goal: 10000,
    training_readiness_score: 71,
    recovery_time_hours: '14.0',
    source_provider: 'garmin',
    ...extra,
  }) as HealthMetricsRow;

describe('buildToday', () => {
  it("uses the end day's wearable summary and last night's sleep", () => {
    const today = buildToday(
      [row('2026-10-19', { total_steps: 1 }), row('2026-10-20')],
      new Map([['2026-10-20', { hours: 7.25, score: 82 }]]),
      '2026-10-20'
    );
    expect(today).toEqual({
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
    });
  });

  it('falls back to yesterday before the device has synced today', () => {
    const today = buildToday([row('2026-10-19')], new Map(), '2026-10-20');
    expect(today?.date).toBe('2026-10-19');
    expect(today?.sleepHours).toBeNull();
  });

  it('is null without any recent data', () => {
    expect(buildToday([row('2026-10-10')], new Map(), '2026-10-20')).toBeNull();
  });
});
