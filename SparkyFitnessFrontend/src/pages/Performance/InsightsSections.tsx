import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COMPARE_METRICS,
  MIN_COMPARE_PAIRS,
  compareMetrics,
  correlationStrength,
  metricSeries,
  type CompareMetric,
  type FitnessFinding,
  type InsightsReportResponse,
  type PerformanceOverviewResponse,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useInsightsReport,
  useInsightsToday,
} from '@/hooks/Performance/useInsights';
import {
  confidenceLabel,
  evidenceLine,
  findingKindLabel,
  findingText,
  formatDelta,
  formatInsightNumber,
  metricLabel,
  normalizeSeries,
} from '@/utils/insightText';
import { ChartCard, SeriesLegend, TrendLineChart } from './PerformanceCharts';

const TONE_COLOR: Record<FitnessFinding['tone'], string> = {
  caution: 'bg-[#c98500]',
  positive: 'bg-[#0ca30c]',
  neutral: 'bg-muted-foreground',
};
const TONE_TEXT: Record<FitnessFinding['tone'], string> = {
  caution: 'text-[#c98500]',
  positive: 'text-[#0ca30c]',
  neutral: 'text-muted-foreground',
};

function FindingItem({
  finding,
  locale,
}: {
  finding: FitnessFinding;
  locale: string;
}) {
  const { t } = useTranslation();
  const text = findingText(t, finding, locale);
  return (
    <li className="flex gap-3" data-testid={`finding-${finding.id}`}>
      <span
        className={`mt-1 w-1 shrink-0 self-stretch rounded-full ${TONE_COLOR[finding.tone]}`}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className={`font-semibold ${TONE_TEXT[finding.tone]}`}>
            {findingKindLabel(t, finding.kind)}
          </span>
          <span className="text-muted-foreground">
            {confidenceLabel(t, finding.confidence)}
          </span>
        </div>
        <p className="font-medium">{text.title}</p>
        {text.detail && (
          <p className="text-sm text-muted-foreground">{text.detail}</p>
        )}
        {finding.evidence.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {finding.evidence
              .map((e) => evidenceLine(t, e, locale))
              .join('  |  ')}
          </p>
        )}
      </div>
    </li>
  );
}

function MissingNote({ missing }: { missing: string[] }) {
  const { t } = useTranslation();
  if (missing.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t('insights.missing', 'Not enough recent data for: {{list}}', {
        list: missing.map((m) => metricLabel(t, m)).join(', '),
      })}
    </p>
  );
}

/**
 * "What matters today": the deterministic findings with their evidence and,
 * when the user has an AI service, a summary that is labelled as AI-worded.
 */
export function TodayInsightsCard({
  shortDate,
}: {
  shortDate: (d: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? 'en';
  const { data, isLoading, isError } = useInsightsToday();
  return (
    <Card data-testid="today-insights">
      <CardHeader className="flex flex-row items-baseline justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">
          {t('insights.today.title', 'What matters today')}
        </CardTitle>
        {data && (
          <span className="text-xs text-muted-foreground">
            {t('insights.today.dataThrough', 'Data through {{date}}', {
              date: shortDate(data.dataThrough),
            })}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            {t('performance.loading', 'Loading…')}
          </p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            {t('insights.error', 'Insights could not be loaded.')}
          </p>
        )}
        {data && (
          <>
            {data.summary && (
              <div className="rounded-md bg-muted/60 p-3">
                <p className="text-sm">{data.summary.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'insights.today.aiWorded',
                    'Worded by your AI service from the findings above'
                  )}
                </p>
              </div>
            )}
            {data.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  'insights.none',
                  'Nothing stands out. Your recent data looks unremarkable.'
                )}
              </p>
            ) : (
              <ul className="space-y-4">
                {data.findings.map((f) => (
                  <FindingItem
                    key={f.id + JSON.stringify(f.params)}
                    finding={f}
                    locale={locale}
                  />
                ))}
              </ul>
            )}
            <MissingNote missing={data.missing} />
            <p className="text-xs text-muted-foreground">
              {t(
                'insights.disclaimer',
                'Computed from your logged and measured data with fixed rules. Not medical advice.'
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Totals = InsightsReportResponse['totals'];

/** Last complete week or calendar month against the one before. */
export function ReportCard({
  shortDate,
}: {
  shortDate: (d: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? 'en';
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const { data, isLoading, isError } = useInsightsReport(period);

  const rows: {
    key: string;
    label: string;
    value: (x: Totals) => number | null;
    unit?: string;
    digits?: number;
  }[] = [
    {
      key: 'strengthDays',
      label: t('insights.report.strengthDays', 'Strength days'),
      value: (x) => x.strengthDays,
    },
    {
      key: 'sets',
      label: t('insights.report.sets', 'Sets'),
      value: (x) => x.strengthSets,
    },
    {
      key: 'volume',
      label: t('insights.report.volume', 'Volume'),
      value: (x) => x.strengthVolumeKg,
      unit: 'kg',
    },
    {
      key: 'runs',
      label: t('insights.report.runs', 'Runs'),
      value: (x) => x.runs,
    },
    {
      key: 'distance',
      label: t('insights.report.distance', 'Running distance'),
      value: (x) => x.runDistanceKm,
      unit: 'km',
      digits: 1,
    },
    {
      key: 'sleep',
      label: t('insights.report.sleep', 'Sleep per night'),
      value: (x) => x.avgSleepHours,
      unit: 'h',
      digits: 1,
    },
    {
      key: 'hrv',
      label: t('insights.report.hrv', 'HRV'),
      value: (x) => x.avgHrv,
      unit: 'ms',
    },
    {
      key: 'restingHr',
      label: t('insights.report.restingHr', 'Resting heart rate'),
      value: (x) => x.avgRestingHr,
      unit: 'bpm',
    },
    {
      key: 'calories',
      label: t('insights.report.calories', 'Calories per day'),
      value: (x) => x.avgCalories,
      unit: 'kcal',
    },
    {
      key: 'protein',
      label: t('insights.report.protein', 'Protein per day'),
      value: (x) => x.avgProtein,
      unit: 'g',
    },
  ];

  return (
    <Card data-testid="insights-report">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">
          {t('insights.report.title', 'Report')}
        </CardTitle>
        <div
          className="flex rounded-md border p-0.5"
          role="group"
          aria-label={t('insights.report.period', 'Report period')}
        >
          {(['week', 'month'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'ghost'}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              {p === 'week'
                ? t('insights.tabs.week', 'Week')
                : t('insights.tabs.month', 'Month')}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <p className="text-sm text-muted-foreground">
            {t('performance.loading', 'Loading…')}
          </p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            {t('insights.error', 'Insights could not be loaded.')}
          </p>
        )}
        {data && (
          <>
            <p className="text-sm text-muted-foreground">
              {shortDate(data.start)} – {shortDate(data.end)} ·{' '}
              {t('insights.report.compared', 'Compared with the period before')}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((row) => {
                  const now = row.value(data.totals);
                  return (
                    <tr key={row.key} className="border-t border-border/60">
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {row.label}
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {now === null
                          ? '–'
                          : `${formatInsightNumber(now, locale, row.digits ?? 0)}${row.unit ? ` ${row.unit}` : ''}`}
                      </td>
                      <td className="w-20 py-1.5 pl-2 text-right text-xs text-muted-foreground tabular-nums">
                        {formatDelta(
                          now,
                          row.value(data.previous),
                          row.digits ?? 0,
                          locale
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.totals.weightStart !== null &&
                  data.totals.weightEnd !== null && (
                    <tr className="border-t border-border/60">
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {t('insights.report.weightChange', 'Weight change')}
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {`${data.totals.weightEnd - data.totals.weightStart > 0 ? '+' : ''}${formatInsightNumber(data.totals.weightEnd - data.totals.weightStart, locale, 1)} kg`}
                      </td>
                      <td />
                    </tr>
                  )}
              </tbody>
            </table>
            {data.bests.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">
                  {t('insights.report.bests', 'Best lifts of the last 90 days')}
                </p>
                <ul className="space-y-0.5 text-sm">
                  {data.bests.map((b) => (
                    <li key={b.exercise} className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">
                        {b.exercise}
                      </span>
                      <span className="font-medium tabular-nums">
                        {t(
                          'insights.report.bestValue',
                          '{{value}} kg · {{date}}',
                          {
                            value: formatInsightNumber(b.e1rmKg, locale, 1),
                            date: shortDate(b.date),
                          }
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.findings.length > 0 && (
              <ul className="space-y-4">
                {data.findings.map((f) => (
                  <FindingItem
                    key={f.id + JSON.stringify(f.params)}
                    finding={f}
                    locale={locale}
                  />
                ))}
              </ul>
            )}
            <MissingNote missing={data.missing} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Two signals of the overview on one axis (shared compareMetrics). The
 * correlation is only shown from MIN_COMPARE_PAIRS pairs and is always
 * presented as an observation.
 */
export function CompareCard({
  data,
  shortDate,
}: {
  data: PerformanceOverviewResponse;
  shortDate: (d: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language ?? 'en';

  const options = useMemo(() => {
    const lifts = data.strength.topLifts.map((l) => ({
      key: `e1rm:${l.exerciseId ?? l.exerciseName}` as CompareMetric,
      label: t('insights.metric.e1rmOf', 'e1RM {{exercise}}', {
        exercise: l.exerciseName,
      }),
    }));
    return [
      ...COMPARE_METRICS.map((m) => ({
        key: m as CompareMetric,
        label: metricLabel(t, m),
      })),
      ...lifts,
    ].filter((o) => metricSeries(data, o.key).length > 0);
  }, [data, t]);

  const pick = (preferred: CompareMetric, not?: CompareMetric) =>
    options.find((o) => o.key === preferred && o.key !== not)?.key ??
    options.find((o) => o.key !== not)?.key;
  const [a, setA] = useState<CompareMetric | undefined>();
  const [b, setB] = useState<CompareMetric | undefined>();
  // Defaults, and a fallback when the range drops a chosen metric.
  const metricA =
    a && options.some((o) => o.key === a) ? a : pick('sleepHours');
  const metricB =
    b && b !== metricA && options.some((o) => o.key === b)
      ? b
      : pick('hrv', metricA);

  const result = useMemo(
    () => (metricA && metricB ? compareMetrics(data, metricA, metricB) : null),
    [data, metricA, metricB]
  );
  const rows = useMemo(() => {
    if (!result) return [];
    const na = normalizeSeries(result.points.map((p) => p.a));
    const nb = normalizeSeries(result.points.map((p) => p.b));
    return result.points.map((p, i) => ({
      date: p.date,
      a: p.a,
      b: p.b,
      na: na[i],
      nb: nb[i],
    }));
  }, [result]);

  const title = t('insights.compare.title', 'Compare');
  if (options.length < 2 || !metricA || !metricB || !result) {
    return (
      <ChartCard title={title} provenance={[]} empty>
        {null}
      </ChartCard>
    );
  }

  const labelOf = (key: CompareMetric) =>
    options.find((o) => o.key === key)?.label ?? key;
  const num = (v: number | null) =>
    v === null ? '–' : formatInsightNumber(v, locale, 1);
  const bucket =
    result.bucket === 'week'
      ? t('insights.compare.weeks', 'weeks')
      : t('insights.compare.days', 'days');
  const strength = correlationStrength(result.correlation);
  const strengthText =
    strength === 'strong'
      ? t('insights.compare.strong', 'Strongly linked')
      : strength === 'moderate'
        ? t('insights.compare.moderate', 'Moderately linked')
        : strength === 'weak'
          ? t('insights.compare.weak', 'Weakly linked')
          : t('insights.compare.noLink', 'No clear link');
  const r =
    result.correlation === null
      ? ''
      : formatInsightNumber(result.correlation, locale, 2);
  const verdict =
    result.pairs < MIN_COMPARE_PAIRS
      ? t(
          'insights.compare.tooFew',
          '{{pairs}} of {{min}} {{bucket}} with both values; too few to judge a link.',
          { pairs: result.pairs, min: MIN_COMPARE_PAIRS, bucket }
        )
      : result.correlation === null
        ? t(
            'insights.compare.flat',
            'No clear link: one of the values does not change ({{pairs}} {{bucket}}).',
            { pairs: result.pairs, bucket }
          )
        : strength === 'none'
          ? t(
              'insights.compare.resultNone',
              '{{strength}} (r = {{r}}, {{pairs}} {{bucket}})',
              { strength: strengthText, r, pairs: result.pairs, bucket }
            )
          : t(
              'insights.compare.result',
              '{{strength}}, moving in {{direction}} (r = {{r}}, {{pairs}} {{bucket}})',
              {
                strength: strengthText,
                direction:
                  result.correlation < 0
                    ? t('insights.compare.inverse', 'opposite directions')
                    : t('insights.compare.same', 'the same direction'),
                r,
                pairs: result.pairs,
                bucket,
              }
            );

  const select = (
    value: CompareMetric,
    exclude: CompareMetric,
    onChange: (v: CompareMetric) => void,
    label: string
  ) => (
    <select
      aria-label={label}
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as CompareMetric)}
    >
      {options
        .filter((o) => o.key !== exclude)
        .map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
    </select>
  );

  return (
    <ChartCard
      title={title}
      provenance={[]}
      className="md:col-span-2"
      subtitle={t(
        'insights.compare.disclaimer',
        'Lines are scaled to their own range. A link is an observation, not a cause.'
      )}
      rows={rows}
      columns={[
        {
          header:
            result.bucket === 'week'
              ? t('performance.week', 'Week')
              : t('insights.compare.day', 'Day'),
          cell: (row) => shortDate(row.date),
        },
        { header: labelOf(metricA), cell: (row) => num(row.a) },
        { header: labelOf(metricB), cell: (row) => num(row.b) },
      ]}
      empty={rows.length < 2}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {select(
          metricA,
          metricB,
          setA,
          t('insights.compare.first', 'First metric')
        )}
        <span className="text-sm text-muted-foreground">
          {t('insights.compare.vs', 'vs.')}
        </span>
        {select(
          metricB,
          metricA,
          setB,
          t('insights.compare.second', 'Second metric')
        )}
      </div>
      <SeriesLegend
        items={[
          { name: labelOf(metricA), color: 'primary' },
          { name: labelOf(metricB), color: 'secondary', dashed: true },
        ]}
      />
      <TrendLineChart
        data={rows}
        xKey="date"
        formatX={shortDate}
        domain={[0, 100]}
        formatValue={() => ''}
        tooltipValue={(row, key) =>
          num(row[key === 'na' ? 'a' : 'b'] as number | null)
        }
        series={[
          { key: 'na', name: labelOf(metricA), color: 'primary' },
          {
            key: 'nb',
            name: labelOf(metricB),
            color: 'secondary',
            dashed: true,
          },
        ]}
      />
      <p data-testid="compare-result" className="mt-3 text-sm font-medium">
        {verdict}
      </p>
    </ChartCard>
  );
}
