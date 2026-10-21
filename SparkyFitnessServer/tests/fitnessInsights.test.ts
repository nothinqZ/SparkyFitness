import { describe, expect, it } from 'vitest';
import {
  compareMetrics,
  correlationStrength,
  deriveFindings,
  missingSignals,
  periodBests,
  periodTotals,
  type PerformanceOverviewResponse,
} from '@workspace/shared';
import {
  buildSummaryPrompt,
  reportPeriod,
} from '../services/insightsService.js';

const END = '2026-10-21'; // a Wednesday

function day(offset: number): string {
  const d = new Date(`${END}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const within = {
  recent: 50,
  baseline: 50,
  baselineStdDev: 5,
  zScore: 0,
  status: 'within' as const,
};

/** An unremarkable 90-day overview; each test changes one thing. */
function overview(
  patch: (o: PerformanceOverviewResponse) => void = () => {}
): PerformanceOverviewResponse {
  const o: PerformanceOverviewResponse = {
    range: { start: day(-89), end: END, timezone: 'UTC' },
    today: null,
    running: {
      provenance: 'measured',
      totals: { runs: 0, distanceKm: 0, durationMinutes: 0 },
      weekly: [],
      runs: [],
      predictions: {
        estimated: {
          '5k': null,
          '10k': null,
          half_marathon: null,
          marathon: null,
        },
        device: null,
        deviceDate: null,
      },
      vo2max: [],
    } as never,
    strength: { provenance: 'estimated', weekly: [], topLifts: [] },
    load: { estimated: [], device: [], current: null },
    recovery: {
      hrv: { series: [], status: within },
      restingHr: { series: [], status: within },
      sleep: {
        series: Array.from({ length: 7 }, (_, i) => ({
          date: day(-i),
          hours: 7.5,
          score: null,
        })),
        nights: 30,
        bedtimeStdDevMinutes: 30,
        meanBedtimeMinutes: 1380,
        avgSleepHours: 7.5,
      },
      readiness: { estimated: null, device: null },
    },
    nutrition: {
      daily: Array.from({ length: 7 }, (_, i) => ({
        date: day(-i),
        calories: 2600,
        protein: 180,
        carbs: 250,
        fat: 80,
      })),
      averages: { days: 7, calories: 2600, protein: 180, carbs: 250, fat: 80 },
    },
    body: {
      weight: Array.from({ length: 10 }, (_, i) => ({
        date: day(-i * 3),
        value: 100,
      })),
      weightAverage7d: [{ date: END, value: 100 }],
      trendKgPerWeek: 0,
    },
  };
  patch(o);
  return o;
}

const ids = (o: PerformanceOverviewResponse) =>
  deriveFindings(o).map((f) => f.id);

describe('deriveFindings', () => {
  it('says nothing about an unremarkable period', () => {
    expect(ids(overview())).toEqual([]);
  });

  it('names a possible strain only when HRV and resting HR agree, as a hypothesis', () => {
    const both = deriveFindings(
      overview((o) => {
        o.recovery.hrv.status = {
          recent: 40,
          baseline: 52,
          baselineStdDev: 5,
          zScore: -2.4,
          status: 'below',
        };
        o.recovery.restingHr.status = {
          recent: 60,
          baseline: 52,
          baselineStdDev: 3,
          zScore: 2.7,
          status: 'above',
        };
      })
    );
    expect(both[0]).toMatchObject({
      id: 'recovery.strained',
      kind: 'hypothesis',
      severity: 'warning',
    });
    expect(both[0]!.evidence.map((e) => e.metric)).toEqual([
      'hrv',
      'hrvBaseline',
      'restingHr',
      'restingHrBaseline',
    ]);

    const hrvOnly = deriveFindings(
      overview((o) => {
        o.recovery.hrv.status = {
          recent: 45,
          baseline: 52,
          baselineStdDev: 5,
          zScore: -1.2,
          status: 'below',
        };
      })
    );
    expect(hrvOnly[0]).toMatchObject({
      id: 'recovery.hrv_low',
      kind: 'observation',
      severity: 'notice',
    });
  });

  it('flags a load spike, with Garmin as the source when it is the device ratio', () => {
    const f = deriveFindings(
      overview((o) => {
        o.load.current = {
          ratio: 1.62,
          zone: 'very_high',
          provenance: 'device',
        };
      })
    )[0]!;
    expect(f).toMatchObject({
      id: 'load.very_high',
      severity: 'warning',
      confidence: 'high',
    });
    expect(f.evidence[0]).toMatchObject({
      metric: 'loadRatio',
      value: 1.62,
      source: 'device',
    });
  });

  it('reports a best of the window only when it was set in the last three days', () => {
    const lift = (bestDate: string) => (o: PerformanceOverviewResponse) => {
      o.strength.topLifts = [
        {
          exerciseId: 'e1',
          exerciseName: 'Bankdrücken',
          bestE1rmKg: 120,
          bestDate,
          sets: 20,
          trend: [
            { date: day(-30), value: 110 },
            { date: bestDate, value: 120 },
          ],
        },
      ];
    };
    expect(deriveFindings(overview(lift(day(-1))))[0]).toMatchObject({
      id: 'strength.best_in_window',
      kind: 'finding',
      tone: 'positive',
      params: { exercise: 'Bankdrücken', e1rm: 120, days: 90 },
    });
    expect(ids(overview(lift(day(-10))))).not.toContain(
      'strength.best_in_window'
    );
  });

  it('suspects a stall after weeks without a better session, and stays silent on thin data', () => {
    const stalled = (points: number) => (o: PerformanceOverviewResponse) => {
      o.strength.topLifts = [
        {
          exerciseId: 'e1',
          exerciseName: 'Kniebeuge',
          bestE1rmKg: 150,
          bestDate: day(-40),
          sets: 30,
          trend: Array.from({ length: points }, (_, i) => ({
            date: day(-60 + i * 7),
            value: i === 2 ? 150 : 145,
          })),
        },
      ];
    };
    const f = deriveFindings(overview(stalled(8)))[0]!;
    expect(f).toMatchObject({
      id: 'strength.stall',
      kind: 'hypothesis',
      confidence: 'medium',
    });
    expect(f.params.weeks).toBeGreaterThanOrEqual(3);
    expect(ids(overview(stalled(4)))).toEqual([]);
  });

  it('notices short sleep over the last week', () => {
    const f = deriveFindings(
      overview((o) => {
        o.recovery.sleep.series = o.recovery.sleep.series.map((n) => ({
          ...n,
          hours: 5.8,
        }));
      })
    )[0]!;
    expect(f).toMatchObject({
      id: 'sleep.short',
      severity: 'warning',
      params: { hours: 5.8, nights: 7 },
    });
  });

  it('compares the last complete week of strength sets with the four before', () => {
    const f = deriveFindings(
      overview((o) => {
        o.strength.weekly = [
          { weekStart: '2026-09-14', volumeKg: 10000, sets: 40, days: 3 },
          { weekStart: '2026-09-21', volumeKg: 10000, sets: 40, days: 3 },
          { weekStart: '2026-09-28', volumeKg: 10000, sets: 40, days: 3 },
          { weekStart: '2026-10-05', volumeKg: 10000, sets: 40, days: 3 },
          { weekStart: '2026-10-12', volumeKg: 3000, sets: 12, days: 1 },
          // The current, unfinished week is ignored.
          { weekStart: '2026-10-19', volumeKg: 0, sets: 2, days: 1 },
        ];
      })
    )[0]!;
    expect(f).toMatchObject({
      id: 'consistency.drop',
      params: { sets: 12, usual: 40, week: '2026-10-12' },
    });
  });

  it('flags low protein per kg only with a week of logged days and a weight', () => {
    const low = (o: PerformanceOverviewResponse) => {
      o.nutrition.daily = o.nutrition.daily.map((d) => ({
        ...d,
        protein: 110,
      }));
    };
    expect(deriveFindings(overview(low))[0]).toMatchObject({
      id: 'nutrition.protein_low',
      params: { grams: 110, perKg: 1.1, days: 7 },
    });
    expect(
      ids(
        overview((o) => {
          low(o);
          o.nutrition.daily = o.nutrition.daily.slice(0, 3);
        })
      )
    ).toEqual([]);
  });

  it('ranks warnings above notices and recovery above other areas', () => {
    const all = ids(
      overview((o) => {
        o.load.current = { ratio: 1.4, zone: 'high', provenance: 'estimated' };
        o.recovery.sleep.series = o.recovery.sleep.series.map((n) => ({
          ...n,
          hours: 5.5,
        }));
        o.recovery.hrv.status = {
          recent: 40,
          baseline: 52,
          baselineStdDev: 5,
          zScore: -2.4,
          status: 'below',
        };
      })
    );
    expect(all).toEqual(['recovery.hrv_low', 'sleep.short', 'load.high']);
  });
});

describe('missingSignals', () => {
  it('lists what the data cannot say', () => {
    const o = overview((x) => {
      x.recovery.hrv.status = {
        ...within,
        zScore: null,
        status: 'insufficient_data',
      };
      x.nutrition.daily = [];
    });
    expect(missingSignals(o)).toEqual(['hrv', 'nutrition']);
  });
});

describe('compareMetrics', () => {
  it('pairs daily metrics by date and reports a correlation from eight pairs', () => {
    const o = overview((x) => {
      x.recovery.hrv.series = Array.from({ length: 10 }, (_, i) => ({
        date: day(-i),
        value: 40 + i,
      }));
      x.recovery.sleep.series = Array.from({ length: 10 }, (_, i) => ({
        date: day(-i),
        hours: 6 + i * 0.2,
        score: null,
      }));
    });
    const r = compareMetrics(o, 'hrv', 'sleepHours');
    expect(r.bucket).toBe('day');
    expect(r.pairs).toBe(10);
    expect(r.correlation).toBe(1);
    expect(correlationStrength(r.correlation)).toBe('strong');
  });

  it('moves a daily metric onto weeks when compared with a weekly one', () => {
    const o = overview((x) => {
      x.strength.weekly = [
        { weekStart: '2026-10-12', volumeKg: 8000, sets: 30 },
        { weekStart: '2026-10-19', volumeKg: 9000, sets: 32 },
      ];
      x.recovery.hrv.series = [
        { date: '2026-10-13', value: 50 },
        { date: '2026-10-15', value: 54 },
        { date: '2026-10-20', value: 48 },
      ];
    });
    const r = compareMetrics(o, 'strengthVolume', 'hrv');
    expect(r.bucket).toBe('week');
    expect(r.points).toEqual([
      { date: '2026-10-12', a: 8000, b: 52 },
      { date: '2026-10-19', a: 9000, b: 48 },
    ]);
    // Two pairs are too few to say anything.
    expect(r.correlation).toBeNull();
  });
});

describe('period report helpers', () => {
  it('picks the last complete week or month', () => {
    expect(reportPeriod('week', END)).toEqual({
      start: '2026-10-12',
      end: '2026-10-18',
      previousStart: '2026-10-05',
      previousEnd: '2026-10-11',
    });
    expect(reportPeriod('month', END)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
      previousStart: '2026-08-01',
      previousEnd: '2026-08-31',
    });
    expect(reportPeriod('month', '2026-01-15')).toMatchObject({
      start: '2025-12-01',
      end: '2025-12-31',
      previousStart: '2025-11-01',
    });
    expect(reportPeriod('week', END, '2026-10-01').start).toBe('2026-09-28');
  });

  it('totals the period and keeps bests that fell into it', () => {
    const o = overview((x) => {
      x.range = { start: '2026-10-12', end: '2026-10-18', timezone: 'UTC' };
      x.strength.weekly = [
        { weekStart: '2026-10-12', volumeKg: 9000, sets: 36, days: 3 },
      ];
      x.strength.topLifts = [
        {
          exerciseId: 'a',
          exerciseName: 'Rudern',
          bestE1rmKg: 100,
          bestDate: '2026-10-15',
          sets: 9,
          trend: [],
        },
        {
          exerciseId: 'b',
          exerciseName: 'Presse',
          bestE1rmKg: 200,
          bestDate: '2026-09-01',
          sets: 9,
          trend: [],
        },
      ];
      x.nutrition.daily = [
        { date: '2026-10-13', calories: 2400, protein: 170, carbs: 0, fat: 0 },
        { date: '2026-10-14', calories: 0, protein: 0, carbs: 0, fat: 0 },
        { date: '2026-10-15', calories: 2600, protein: 190, carbs: 0, fat: 0 },
      ];
      x.body.weight = [
        { date: '2026-10-12', value: 101 },
        { date: '2026-10-18', value: 100.4 },
      ];
    });
    expect(periodTotals(o)).toMatchObject({
      strengthDays: 3,
      strengthSets: 36,
      strengthVolumeKg: 9000,
      avgCalories: 2500,
      avgProtein: 180,
      nutritionDays: 2,
      weightStart: 101,
      weightEnd: 100.4,
    });
    expect(periodBests(o, '2026-10-12', '2026-10-18')).toEqual([
      { exercise: 'Rudern', e1rmKg: 100, date: '2026-10-15' },
    ]);
  });
});

describe('buildSummaryPrompt', () => {
  it('limits the model to the findings, keeps their status and names missing data', () => {
    const findings = deriveFindings(
      overview((o) => {
        o.load.current = {
          ratio: 1.62,
          zone: 'very_high',
          provenance: 'device',
        };
      })
    );
    const prompt = buildSummaryPrompt(findings, ['hrv'], 'de-DE');
    expect(prompt).toContain('in German');
    expect(prompt).toContain('Use ONLY the findings below');
    expect(prompt).toContain('"rule":"load.very_high"');
    expect(prompt).toContain('must not be guessed: hrv');
  });
});
