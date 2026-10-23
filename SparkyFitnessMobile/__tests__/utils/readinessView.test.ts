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
});
