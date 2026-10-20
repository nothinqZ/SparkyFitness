# Performance analytics

The **Performance** page (web, `/performance`) and
`GET /api/v2/performance/overview` combine running, strength, training load,
recovery, nutrition and body-weight data for a date range (7–366 days,
default 90).

Every number is labelled with where it comes from:

| Label | Meaning | Examples |
| --- | --- | --- |
| **Measured** | Recorded by a device or logged by you | Runs, sets, resting heart rate, overnight HRV, sleep, weight, food |
| **Device** | Computed by your wearable's vendor | Garmin VO2max, race predictions, acute/chronic load, training readiness |
| **Estimated** | Computed by SparkyFitness with the formulas below | e1RM, Riegel race times, our ACWR, baselines, readiness estimate |

Estimates are orientation, not diagnosis. Where Garmin provides its own value
the page shows both side by side.

The formulas live in `shared/src/analytics/performance.ts` and are covered by
`SparkyFitnessServer/tests/performanceAnalytics.test.ts` (hand-calculated
expected values) and `scripts/e2e/performanceOverview.e2e.ts` (real database).

## Running

- **Runs** are exercise entries with distance and duration whose category is
  `running` or whose name matches run/running/jog/treadmill (whole words, so
  "crunch" is not a run).
- **Pace** = duration ÷ distance (s/km). Weekly pace is distance-weighted.
- **Weekly mileage** groups by ISO week (Monday start); weeks without runs
  appear as 0.
- **Race predictions (estimated)** use Riegel's formula
  `T₂ = T₁ × (D₂ / D₁)^1.06` from every run of at least 3 km and keep the
  fastest prediction per distance. It assumes the run was a hard effort;
  easy runs predict slow times, which is why only the best one counts.
  Riegel tends to be optimistic for the marathon when weekly volume is low.

## Strength

- **Volume** = Σ weight × reps of weighted working sets (warm-ups and
  bodyweight-modality exercises excluded).
- **Estimated 1RM** (Epley) = `weight × (1 + reps / 30)`, only for sets of
  1–10 reps, where the formula is reasonably accurate.
- **Top lifts** are the six exercises with the most qualifying sets in the
  range, with their best e1RM and its daily trend.

## Training load

- **Device ACWR**: Garmin's acute/chronic load and ratio, used when Garmin
  reported a ratio within the last three days of the range.
- **Estimated ACWR**: acute = mean daily training load of the last 7 days,
  chronic = mean of the last 28 (rest days count as 0), from the per-activity
  training load Garmin attaches to each workout. No ratio is shown until 28
  days have passed since the first recorded load (before that the chronic
  mean is mostly empty days and the ratio would be inflated).
- **Zones** (Gabbett 2016): < 0.8 low, 0.8–1.3 optimal, 1.3–1.5 high,
  > 1.5 very high. The evidence linking ACWR to injury risk is debated; use it
  as a ramp-rate signal.

## Recovery

- **Baselines** (HRV from overnight sleep data, resting heart rate): the mean
  of the last 7 days is compared with the mean and standard deviation of the
  60 days before. More than one standard deviation away is "below"/"above".
  At least 14 baseline days and 3 recent days are required, otherwise the
  status is "insufficient data".
- **Sleep consistency**: circular standard deviation of bedtime over the last
  30 nights, in your timezone (23:30 and 00:30 are one hour apart). Under
  ~30 minutes is regular.
- **Readiness estimate** (0–100): the average of the available components,
  needing at least two:
  - HRV: `50 + 20 × z`
  - resting HR: `50 − 20 × z`
  - last night's sleep: `hours ÷ 8 × 100` (capped at 100)
  - load: 100 for ACWR 0.8–1.3, falling to 0 at 0.0 and at 2.0
  This is a heuristic; Garmin's training readiness is shown next to it when
  available.

## Nutrition and body

- Daily calories and macros are the same totals the Reports page uses
  (food entries scaled by quantity, plus supplements). Averages count only
  days with logged food.
- **Weight trend** is the least-squares slope in kg per week; the chart also
  shows a 7-day moving average.
