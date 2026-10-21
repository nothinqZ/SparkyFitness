import { describe, expect, it } from 'vitest';
import {
  acuteChronicLoad,
  baselineStatus,
  classifyAcwr,
  isoWeekStart,
  movingAverage,
  paceSecondsPerKm,
  predictRaceTimesRiegel,
  recoveryEstimate,
  riegelPredictSeconds,
  sleepConsistency,
  weeklyRunSummaries,
  weeklyTrend,
  type DatedValue,
} from '@workspace/shared';

// Shared calculations behind /api/v2/performance. Expected values are worked
// out by hand in the comments, so a formula change shows up as a diff here.

const days = (
  start: string,
  n: number,
  f: (i: number) => number
): DatedValue[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value: f(i),
  }));

describe('running', () => {
  it('computes pace in seconds per km', () => {
    // 50 min for 10 km = 300 s/km (5:00/km)
    expect(paceSecondsPerKm({ distanceKm: 10, durationMinutes: 50 })).toBe(300);
    expect(paceSecondsPerKm({ distanceKm: 0, durationMinutes: 50 })).toBeNull();
  });

  it('groups weeks from Monday and fills empty weeks', () => {
    expect(isoWeekStart('2026-10-25')).toBe('2026-10-19'); // Sunday -> Monday
    expect(isoWeekStart('2026-10-19')).toBe('2026-10-19');
    const weeks = weeklyRunSummaries([
      { date: '2026-10-05', distanceKm: 5, durationMinutes: 30 },
      { date: '2026-10-07', distanceKm: 10, durationMinutes: 55 },
      { date: '2026-10-20', distanceKm: 8, durationMinutes: 40 },
    ]);
    expect(weeks.map((w) => [w.weekStart, w.distanceKm, w.runs])).toEqual([
      ['2026-10-05', 15, 2],
      ['2026-10-12', 0, 0],
      ['2026-10-19', 8, 1],
    ]);
    // Distance-weighted: 85 min / 15 km = 340 s/km
    expect(weeks[0]!.avgPaceSecondsPerKm).toBe(340);
    expect(weeks[1]!.avgPaceSecondsPerKm).toBeNull();
  });

  it("predicts race times with Riegel's formula from the best eligible run", () => {
    // 20:00 5k -> 10k: 1200 × 2^1.06 = 2501.8 s (41:42)
    expect(Math.round(riegelPredictSeconds(5, 1200, 10))).toBe(2502);
    const predictions = predictRaceTimesRiegel([
      { date: '2026-10-01', distanceKm: 5, durationMinutes: 20 },
      { date: '2026-10-08', distanceKm: 10, durationMinutes: 50 }, // slower
      { date: '2026-10-09', distanceKm: 1, durationMinutes: 3 }, // too short to use
    ]);
    expect(predictions['5k']).toEqual({
      seconds: 1200,
      basedOn: { date: '2026-10-01', distanceKm: 5 },
    });
    expect(predictions['10k']!.seconds).toBe(2502);
    // 1200 × (42.195/5)^1.06 = 11,509 s (3:11:49)
    expect(predictions.marathon!.seconds).toBe(11509);
    expect(predictRaceTimesRiegel([])['5k']).toBeNull();
  });
});

describe('training load', () => {
  it('computes 7/28-day rolling means and the ratio', () => {
    // 100 load every day for 28 days: acute = chronic = 100, ratio 1
    const steady = acuteChronicLoad(
      days('2026-09-01', 28, () => 100),
      '2026-09-28',
      '2026-09-28'
    );
    expect(steady).toEqual([
      { date: '2026-09-28', acute: 100, chronic: 100, ratio: 1 },
    ]);
    // 28 days of history, then a 700 spike: acute (6×10 + 700)/7 = 108.6,
    // chronic (27×10 + 700)/28 = 34.6, ratio 108.571/34.643 = 3.13
    const spike = acuteChronicLoad(
      [...days('2026-09-01', 27, () => 10), { date: '2026-09-28', value: 700 }],
      '2026-09-28',
      '2026-09-28'
    );
    expect(spike[0]).toMatchObject({
      acute: 108.6,
      chronic: 34.6,
      ratio: 3.13,
    });
    // Less than 28 days of history: no ratio, the chronic mean is not real yet.
    const young = acuteChronicLoad(
      [{ date: '2026-09-28', value: 700 }],
      '2026-09-28',
      '2026-09-28'
    );
    expect(young[0]).toMatchObject({ acute: 100, chronic: 25, ratio: null });
    // Two sessions on the same day add up.
    const sameDay = acuteChronicLoad(
      [
        { date: '2026-09-28', value: 70 },
        { date: '2026-09-28', value: 70 },
      ],
      '2026-09-28',
      '2026-09-28'
    );
    expect(sameDay[0]!.acute).toBe(20);
    expect(
      acuteChronicLoad([], '2026-09-28', '2026-09-28')[0]!.ratio
    ).toBeNull();
  });

  it('classifies ACWR bands', () => {
    expect(classifyAcwr(0.5)).toBe('low');
    expect(classifyAcwr(1.0)).toBe('optimal');
    expect(classifyAcwr(1.3)).toBe('optimal');
    expect(classifyAcwr(1.4)).toBe('high');
    expect(classifyAcwr(1.6)).toBe('very_high');
    expect(classifyAcwr(null)).toBeNull();
  });
});

describe('recovery', () => {
  // 60 baseline days alternating 48/52 (mean 50, sd ~2.02), then 7 recent days.
  const history = days('2026-08-01', 60, (i) => (i % 2 ? 52 : 48));
  const asOf = '2026-10-06'; // recent window: 2026-09-30 .. 2026-10-06

  it('compares the last 7 days with the 60 before', () => {
    const low = baselineStatus(
      [...history, ...days('2026-09-30', 7, () => 44)],
      asOf
    );
    expect(low.baseline).toBe(50);
    expect(low.recent).toBe(44);
    expect(low.status).toBe('below');
    expect(low.zScore).toBeCloseTo(-2.97, 1);
    const normal = baselineStatus(
      [...history, ...days('2026-09-30', 7, () => 51)],
      asOf
    );
    expect(normal.status).toBe('within');
  });

  it('refuses to judge without enough history', () => {
    const status = baselineStatus(
      days('2026-09-25', 12, () => 50),
      asOf
    );
    expect(status.status).toBe('insufficient_data');
    expect(status.zScore).toBeNull();
  });

  it('measures bedtime regularity across midnight', () => {
    // 23:30, 00:30, 23:30, 00:30: mean 00:00, circular sd ~30 min
    const nights = [
      '2026-10-01T23:30:00Z',
      '2026-10-03T00:30:00Z',
      '2026-10-03T23:30:00Z',
      '2026-10-05T00:30:00Z',
    ].map((bedtime, i) => ({
      date: `2026-10-0${i + 1}`,
      bedtime,
      durationSeconds: 7.5 * 3600,
    }));
    const result = sleepConsistency(nights, 'UTC');
    expect(result.meanBedtimeMinutes).toBe(0);
    expect(result.bedtimeStdDevMinutes).toBeGreaterThanOrEqual(29);
    expect(result.bedtimeStdDevMinutes).toBeLessThanOrEqual(31);
    expect(result.avgSleepHours).toBe(7.5);
    // Same instants seen from Berlin (UTC+2 in October): mean 02:00
    expect(sleepConsistency(nights, 'Europe/Berlin').meanBedtimeMinutes).toBe(
      120
    );
  });

  it('combines available signals into an estimate', () => {
    const est = recoveryEstimate({
      hrv: {
        recent: 55,
        baseline: 50,
        baselineStdDev: 5,
        zScore: 1,
        status: 'within',
      },
      restingHr: {
        recent: 50,
        baseline: 50,
        baselineStdDev: 2,
        zScore: 0,
        status: 'within',
      },
      lastNightSleepHours: 6,
      acwr: 1.65,
    });
    // hrv 70, rhr 50, sleep 75, load 100 - (0.35/0.7)*100 = 50 -> mean 61.25
    expect(est).toEqual({
      score: 61,
      components: { hrv: 70, restingHr: 50, sleep: 75, load: 50 },
    });
    expect(recoveryEstimate({ lastNightSleepHours: 8 })).toBeNull();
  });
});

describe('trends', () => {
  it('reports the weekly slope', () => {
    // -0.1 kg per day = -0.7 kg per week
    expect(weeklyTrend(days('2026-09-01', 21, (i) => 80 - i * 0.1))).toBe(-0.7);
    expect(weeklyTrend(days('2026-09-01', 2, () => 80))).toBeNull();
  });

  it('smooths with a trailing calendar window', () => {
    const avg = movingAverage(
      [
        { date: '2026-09-01', value: 80 },
        { date: '2026-09-03', value: 82 },
        { date: '2026-09-20', value: 70 },
      ],
      7
    );
    expect(avg.map((p) => p.value)).toEqual([80, 81, 70]);
  });
});
