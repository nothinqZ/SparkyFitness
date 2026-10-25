import type { PerformanceOverviewResponse } from '@workspace/shared';
import {
  factorStatus,
  readinessLevel,
  readinessView,
} from '../../src/utils/readinessView';

const overview = (
  score: number | null,
  components: Record<string, number>,
  zone: 'low' | 'optimal' | 'high' | 'very_high' = 'optimal',
  device: number | null = null
) =>
  ({
    range: {
      start: '2026-10-01',
      end: '2026-10-25',
      timezone: 'Europe/Berlin',
    },
    today: { date: '2026-10-25', trainingReadiness: device },
    recovery: {
      readiness: {
        estimated: score === null ? null : { score, components },
        device,
      },
    },
    load: { current: { ratio: 1, zone, provenance: 'estimated' } },
  }) as unknown as PerformanceOverviewResponse;

describe('readiness view', () => {
  it("uses Garmin's bands", () => {
    expect([90, 75, 74, 50, 49, 25, 24].map(readinessLevel)).toEqual([
      'high',
      'high',
      'moderate',
      'moderate',
      'low',
      'low',
      'poor',
    ]);
    expect([80, 67, 66, 34, 33].map(factorStatus)).toEqual([
      'good',
      'good',
      'fair',
      'fair',
      'poor',
    ]);
  });

  it('lists the factors in a fixed order and names the weakest on an easy day', () => {
    const view = readinessView(
      overview(40, { load: 70, sleep: 30, hrv: 55, restingHr: 60 })
    )!;
    expect(view.factors.map((f) => f.key)).toEqual([
      'sleep',
      'hrv',
      'restingHr',
      'load',
    ]);
    expect(view.advice).toBe('easy');
    expect(view.limiting).toBe('sleep');
  });

  it('trains on a high score, but not into a very high load', () => {
    expect(readinessView(overview(82, { sleep: 90, hrv: 80 }))!.advice).toBe(
      'train'
    );
    const loaded = readinessView(
      overview(82, { sleep: 90, hrv: 80 }, 'very_high')
    )!;
    expect(loaded.advice).toBe('easy');
    expect(loaded.limiting).toBe('load');
  });

  it("falls back to Garmin's own score", () => {
    const view = readinessView(overview(null, {}, 'optimal', 64))!;
    expect(view.source).toBe('device');
    expect(view.level).toBe('moderate');
    expect(view.factors).toEqual([]);
    expect(readinessView(overview(null, {}))).toBeNull();
  });

  it('does not recommend hard training from yesterday’s data', () => {
    const data = overview(90, { sleep: 90, hrv: 80 });
    data.today!.date = '2026-10-24';
    expect(readinessView(data)).toMatchObject({
      current: false,
      advice: 'unknown',
    });
  });

  it('does not use a stale device score as today’s score', () => {
    const data = overview(null, {}, 'optimal', 90);
    data.today!.date = '2026-10-24';
    expect(readinessView(data)).toBeNull();
  });

  it('withholds a recommendation when an estimate has only one factor', () => {
    expect(readinessView(overview(88, { sleep: 90 }))).toMatchObject({
      current: true,
      advice: 'unknown',
      missingFactors: ['hrv', 'restingHr', 'load'],
    });
  });
});
