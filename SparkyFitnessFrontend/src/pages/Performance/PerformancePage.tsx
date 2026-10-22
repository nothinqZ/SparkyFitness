import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BedDouble,
  ChevronsLeft,
  ChevronsRight,
  Dumbbell,
  Eye,
  EyeOff,
  Footprints,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  Scale,
  Sparkles,
  Utensils,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import type { PerformanceOverviewResponse } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { usePerformanceOverview } from '@/hooks/Performance/usePerformanceOverview';
import {
  PERFORMANCE_RANGES,
  usePerformanceLayout,
  type PerformanceSection,
} from '@/hooks/Performance/usePerformanceLayout';
import {
  convertDistance,
  formatClockMinutes,
  formatDuration,
  formatPace,
} from '@/utils/performanceFormat';
import {
  ChartCard,
  ProvenanceBadge,
  SeriesLegend,
  TrendBarChart,
  TrendLineChart,
} from './PerformanceCharts';
import { CompareCard, ReportCard, TodayInsightsCard } from './InsightsSections';

type Overview = PerformanceOverviewResponse;

const SECTION_ICONS: Record<PerformanceSection, typeof Activity> = {
  insights: Sparkles,
  overview: LayoutDashboard,
  compare: GitCompareArrows,
  running: Footprints,
  strength: Dumbbell,
  load: Gauge,
  recovery: BedDouble,
  nutrition: Utensils,
  body: Scale,
};

function Kpi({
  label,
  value,
  detail,
  provenance,
  status,
}: {
  label: string;
  value: string;
  detail?: string;
  provenance: 'measured' | 'device' | 'estimated';
  status?: { tone: 'good' | 'warning' | 'critical'; label: string } | null;
}) {
  const StatusIcon =
    status?.tone === 'good'
      ? CheckCircle2
      : status?.tone === 'critical'
        ? AlertTriangle
        : Info;
  const statusColor =
    status?.tone === 'good'
      ? 'text-[#0ca30c]'
      : status?.tone === 'critical'
        ? 'text-[#d03b3b]'
        : 'text-[#c98500]';
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <ProvenanceBadge provenance={provenance} />
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {status && (
          <div className="flex items-center gap-1 text-xs">
            <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} aria-hidden />
            <span className="text-muted-foreground">{status.label}</span>
          </div>
        )}
        {detail && (
          <div className="text-xs text-muted-foreground">{detail}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const { t } = useTranslation();
  const { distanceUnit, weightUnit, convertWeight, formatDateInUserTimezone } =
    usePreferences();
  const { layout, update, toggleSection } = usePerformanceLayout();
  const { data, isLoading, isError } = usePerformanceOverview(layout.days);

  const distUnit: 'km' | 'miles' = distanceUnit === 'miles' ? 'miles' : 'km';
  const distLabel = distUnit === 'miles' ? 'mi' : 'km';
  const wUnit = weightUnit === 'kg' ? 'kg' : 'lbs';
  const toWeight = (kg: number) =>
    wUnit === 'kg' ? kg : convertWeight(kg, 'kg', 'lbs');
  const shortDate = (d: string) => formatDateInUserTimezone(d, 'MMM d');

  const sectionLabels: Record<PerformanceSection, string> = {
    insights: t('performance.sections.insights', 'Insights'),
    overview: t('performance.sections.overview', 'Overview'),
    compare: t('performance.sections.compare', 'Compare'),
    running: t('performance.sections.running', 'Running'),
    strength: t('performance.sections.strength', 'Strength'),
    load: t('performance.sections.load', 'Training load'),
    recovery: t('performance.sections.recovery', 'Sleep & recovery'),
    nutrition: t('performance.sections.nutrition', 'Nutrition'),
    body: t('performance.sections.body', 'Body'),
  };
  const visible = (s: PerformanceSection) => !layout.hidden.includes(s);

  return (
    <div className="flex w-full gap-6">
      <aside
        className={`sticky top-4 hidden h-fit shrink-0 rounded-lg border bg-card p-2 transition-[width] lg:block ${
          layout.sidebarCollapsed ? 'w-12' : 'w-56'
        }`}
        aria-label={t('performance.sidebar', 'Dashboard sections')}
      >
        <Button
          variant="ghost"
          size="icon"
          className="mb-1 h-8 w-8"
          aria-label={
            layout.sidebarCollapsed
              ? t('performance.expandSidebar', 'Expand sidebar')
              : t('performance.collapseSidebar', 'Collapse sidebar')
          }
          onClick={() => update({ sidebarCollapsed: !layout.sidebarCollapsed })}
        >
          {layout.sidebarCollapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </Button>
        <nav className="space-y-0.5">
          {(Object.keys(SECTION_ICONS) as PerformanceSection[]).map((s) => {
            const Icon = SECTION_ICONS[s];
            return (
              <div key={s} className="group flex items-center gap-1">
                <a
                  href={`#perf-${s}`}
                  className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
                    visible(s) ? '' : 'text-muted-foreground line-through'
                  }`}
                  title={sectionLabels[s]}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!layout.sidebarCollapsed && <span>{sectionLabels[s]}</span>}
                </a>
                {!layout.sidebarCollapsed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={
                      visible(s)
                        ? t('performance.hideSection', 'Hide {{section}}', {
                            section: sectionLabels[s],
                          })
                        : t('performance.showSection', 'Show {{section}}', {
                            section: sectionLabels[s],
                          })
                    }
                    onClick={() => toggleSection(s)}
                  >
                    {visible(s) ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {t('performance.title', 'Performance')}
            </h1>
            {data && (
              <p className="text-sm text-muted-foreground">
                {formatDateInUserTimezone(data.range.start)} –{' '}
                {formatDateInUserTimezone(data.range.end)}
              </p>
            )}
          </div>
          <div
            className="flex rounded-md border p-0.5"
            role="group"
            aria-label={t('performance.range', 'Date range')}
          >
            {PERFORMANCE_RANGES.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={layout.days === d ? 'default' : 'ghost'}
                aria-pressed={layout.days === d}
                onClick={() => update({ days: d })}
              >
                {d === 365
                  ? t('performance.rangeYear', '1 year')
                  : t('performance.rangeDays', '{{count}} days', { count: d })}
              </Button>
            ))}
          </div>
        </header>

        {isLoading && (
          <p className="text-sm text-muted-foreground">
            {t('performance.loading', 'Loading…')}
          </p>
        )}
        {isError && (
          <p className="text-sm text-destructive">
            {t('performance.loadError', 'Failed to load performance data')}
          </p>
        )}
        {data && (
          <Dashboard
            data={data}
            visible={visible}
            labels={sectionLabels}
            distUnit={distUnit}
            distLabel={distLabel}
            wUnit={wUnit}
            toWeight={toWeight}
            shortDate={shortDate}
          />
        )}
      </div>
    </div>
  );
}

function Dashboard({
  data,
  visible,
  labels,
  distUnit,
  distLabel,
  wUnit,
  toWeight,
  shortDate,
}: {
  data: Overview;
  visible: (s: PerformanceSection) => boolean;
  labels: Record<PerformanceSection, string>;
  distUnit: 'km' | 'miles';
  distLabel: string;
  wUnit: 'kg' | 'lbs';
  toWeight: (kg: number) => number;
  shortDate: (d: string) => string;
}) {
  const { t } = useTranslation();
  const { running, strength, load, recovery, nutrition, body } = data;
  const grid =
    'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[2200px]:grid-cols-4';

  const weekly = useMemo(
    () =>
      running.weekly.map((w) => ({
        ...w,
        distance: Math.round(convertDistance(w.distanceKm, distUnit) * 10) / 10,
      })),
    [running.weekly, distUnit]
  );
  const weightRows = useMemo(() => {
    const avg = new Map(body.weightAverage7d.map((p) => [p.date, p.value]));
    return body.weight.map((p) => ({
      date: p.date,
      weight: Math.round(toWeight(p.value) * 10) / 10,
      average: Math.round(toWeight(avg.get(p.date) ?? p.value) * 10) / 10,
    }));
  }, [body, toWeight]);
  const loadRows = useMemo(() => {
    const device = new Map(load.device.map((p) => [p.date, p.ratio]));
    return load.estimated.map((p) => ({
      date: p.date,
      estimated: p.ratio,
      device: device.get(p.date) ?? null,
    }));
  }, [load]);
  const hasDeviceLoad = load.device.some((p) => p.ratio !== null);

  const zoneLabel = (zone: string) =>
    ({
      low: t('performance.zone.low', 'Low (< 0.8)'),
      optimal: t('performance.zone.optimal', 'Optimal (0.8–1.3)'),
      high: t('performance.zone.high', 'High (1.3–1.5)'),
      very_high: t('performance.zone.veryHigh', 'Very high (> 1.5)'),
    })[zone] ?? zone;
  const baselineLabel = (status: string) =>
    ({
      below: t('performance.baseline.below', 'Below baseline'),
      within: t('performance.baseline.within', 'Within baseline'),
      above: t('performance.baseline.above', 'Above baseline'),
      insufficient_data: t(
        'performance.baseline.insufficient',
        'Not enough history yet'
      ),
    })[status] ?? status;
  const avgPace =
    running.totals.distanceKm > 0
      ? (running.totals.durationMinutes * 60) / running.totals.distanceKm
      : null;
  const latestVo2 = running.vo2max.at(-1);

  const raceRows = (
    [
      ['5k', '5 km'],
      ['10k', '10 km'],
      ['half_marathon', t('performance.halfMarathon', 'Half marathon')],
      ['marathon', t('performance.marathon', 'Marathon')],
    ] as const
  ).map(([key, label]) => ({
    label,
    device: running.predictions.device?.[key] ?? null,
    estimated: running.predictions.estimated[key],
    range: running.predictions.estimatedRange[key],
  }));
  const statusLabel = (status: string) =>
    ({
      productive: t('performance.status.productive', 'Productive'),
      maintaining: t('performance.status.maintaining', 'Maintaining'),
      recovery: t('performance.status.recovery', 'Recovery'),
      unproductive: t('performance.status.unproductive', 'Unproductive'),
      strained: t('performance.status.strained', 'Strained'),
      overreaching: t('performance.status.overreaching', 'Overreaching'),
      detraining: t('performance.status.detraining', 'Detraining'),
    })[status] ?? status;

  return (
    <>
      {visible('insights') && (
        <section id="perf-insights" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.insights}</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TodayInsightsCard shortDate={shortDate} />
            <ReportCard shortDate={shortDate} />
          </div>
        </section>
      )}

      {visible('overview') && (
        <section id="perf-overview" className="scroll-mt-4 space-y-3">
          <h2 className="sr-only">{labels.overview}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 min-[1800px]:grid-cols-8">
            <Kpi
              label={t('performance.kpi.distance', 'Running distance')}
              value={`${convertDistance(running.totals.distanceKm, distUnit).toFixed(1)} ${distLabel}`}
              detail={t('performance.kpi.runs', '{{count}} runs', {
                count: running.totals.runs,
              })}
              provenance="measured"
            />
            <Kpi
              label={t('performance.kpi.pace', 'Average pace')}
              value={formatPace(avgPace, distUnit)}
              provenance="measured"
            />
            <Kpi
              label="VO2max"
              value={latestVo2 ? latestVo2.value.toFixed(1) : '–'}
              detail={latestVo2 ? shortDate(latestVo2.date) : undefined}
              provenance="device"
            />
            <Kpi
              label={t('performance.kpi.acwr', 'Load ratio (ACWR)')}
              value={load.current ? load.current.ratio.toFixed(2) : '–'}
              detail={
                load.trainingStatus
                  ? t('performance.kpi.trainingStatus', 'Status: {{status}}', {
                      status: statusLabel(load.trainingStatus.status),
                    })
                  : undefined
              }
              provenance={load.current?.provenance ?? 'estimated'}
              status={
                load.current
                  ? {
                      tone:
                        load.current.zone === 'optimal'
                          ? 'good'
                          : load.current.zone === 'very_high'
                            ? 'critical'
                            : 'warning',
                      label: zoneLabel(load.current.zone),
                    }
                  : null
              }
            />
            <Kpi
              label={t('performance.kpi.readiness', 'Readiness')}
              value={
                recovery.readiness.estimated
                  ? String(recovery.readiness.estimated.score)
                  : '–'
              }
              detail={
                recovery.readiness.device !== null
                  ? t('performance.kpi.garminReadiness', 'Garmin: {{value}}', {
                      value: recovery.readiness.device,
                    })
                  : undefined
              }
              provenance="estimated"
            />
            <Kpi
              label="HRV"
              value={
                recovery.hrv.status.recent !== null
                  ? `${recovery.hrv.status.recent} ms`
                  : '–'
              }
              provenance="measured"
              status={{
                tone:
                  recovery.hrv.status.status === 'below'
                    ? 'critical'
                    : recovery.hrv.status.status === 'insufficient_data'
                      ? 'warning'
                      : 'good',
                label: baselineLabel(recovery.hrv.status.status),
              }}
            />
            <Kpi
              label={t('performance.kpi.sleep', 'Sleep (avg)')}
              value={
                recovery.sleep.avgSleepHours !== null
                  ? `${recovery.sleep.avgSleepHours.toFixed(1)} h`
                  : '–'
              }
              detail={
                recovery.sleep.bedtimeStdDevMinutes !== null
                  ? t(
                      'performance.kpi.bedtimeSpread',
                      'Bedtime ±{{minutes}} min',
                      {
                        minutes: recovery.sleep.bedtimeStdDevMinutes,
                      }
                    )
                  : undefined
              }
              provenance="measured"
            />
            <Kpi
              label={t('performance.kpi.weightTrend', 'Weight trend')}
              value={
                body.trendKgPerWeek !== null
                  ? `${body.trendKgPerWeek > 0 ? '+' : ''}${toWeight(body.trendKgPerWeek).toFixed(2)} ${wUnit}/${t('performance.weekShort', 'wk')}`
                  : '–'
              }
              provenance="estimated"
            />
          </div>
        </section>
      )}

      {visible('compare') && (
        <section id="perf-compare" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.compare}</h2>
          <div className={grid}>
            <CompareCard data={data} shortDate={shortDate} />
          </div>
        </section>
      )}

      {visible('running') && (
        <section id="perf-running" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.running}</h2>
          <div className={grid}>
            <ChartCard
              title={t('performance.weeklyDistance', 'Weekly distance')}
              provenance={['measured']}
              empty={weekly.length === 0}
              rows={weekly}
              columns={[
                {
                  header: t('performance.week', 'Week'),
                  cell: (r) => shortDate(r.weekStart),
                },
                { header: distLabel, cell: (r) => r.distance },
                { header: t('performance.runs', 'Runs'), cell: (r) => r.runs },
                {
                  header: t('performance.pace', 'Pace'),
                  cell: (r) => formatPace(r.avgPaceSecondsPerKm, distUnit),
                },
              ]}
            >
              <TrendBarChart
                data={weekly}
                xKey="weekStart"
                yKey="distance"
                name={distLabel}
                formatX={shortDate}
                formatValue={(v) => `${v}`}
              />
            </ChartCard>
            <ChartCard
              title={t('performance.paceTrend', 'Pace trend (weekly)')}
              subtitle={t('performance.fasterIsUp', 'Faster is higher')}
              provenance={['measured']}
              empty={weekly.every((w) => w.avgPaceSecondsPerKm === null)}
            >
              <TrendLineChart
                data={weekly.filter((w) => w.avgPaceSecondsPerKm !== null)}
                xKey="weekStart"
                series={[
                  {
                    key: 'avgPaceSecondsPerKm',
                    name: t('performance.pace', 'Pace'),
                    color: 'primary',
                    dots: true,
                  },
                ]}
                formatX={shortDate}
                formatValue={(v) =>
                  formatPace(v, distUnit).replace(/ \/.*$/, '')
                }
                reversed
              />
            </ChartCard>
            <ChartCard
              title="VO2max"
              provenance={['device']}
              empty={running.vo2max.length === 0}
              rows={running.vo2max}
              columns={[
                {
                  header: t('performance.date', 'Date'),
                  cell: (r) => shortDate(r.date),
                },
                { header: 'VO2max', cell: (r) => r.value },
              ]}
            >
              <TrendLineChart
                data={running.vo2max}
                xKey="date"
                series={[{ key: 'value', name: 'VO2max', color: 'primary' }]}
                formatX={shortDate}
              />
            </ChartCard>
            <ChartCard
              title={t('performance.racePredictions', 'Race predictions')}
              subtitle={
                running.predictions.deviceDate
                  ? t('performance.garminAsOf', 'Garmin as of {{date}}', {
                      date: shortDate(running.predictions.deviceDate),
                    })
                  : t(
                      'performance.riegelNote',
                      'Estimate: Riegel formula from your best run ≥ 3 km'
                    )
              }
              provenance={['device', 'estimated']}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">
                      {t('performance.distance', 'Distance')}
                    </th>
                    <th className="py-1 font-medium">Garmin</th>
                    <th className="py-1 font-medium">
                      {t('performance.provenance.estimated', 'Estimated')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {raceRows.map((r) => (
                    <tr
                      key={r.label}
                      className="border-t border-border/60 tabular-nums"
                    >
                      <td className="py-1.5">{r.label}</td>
                      <td className="py-1.5">{formatDuration(r.device)}</td>
                      <td className="py-1.5 italic text-muted-foreground">
                        {formatDuration(r.estimated)}
                        {r.range && r.range.samples > 1 && (
                          <span className="block text-xs not-italic">
                            {formatDuration(r.range.low)}–
                            {formatDuration(r.range.high)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartCard>
          </div>
        </section>
      )}

      {visible('strength') && (
        <section id="perf-strength" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.strength}</h2>
          <div className={grid}>
            <ChartCard
              title={t('performance.weeklyVolume', 'Weekly volume')}
              subtitle={t(
                'performance.volumeNote',
                'Weight × reps of working sets'
              )}
              provenance={['measured']}
              empty={strength.weekly.length === 0}
              rows={strength.weekly}
              columns={[
                {
                  header: t('performance.week', 'Week'),
                  cell: (r) => shortDate(r.weekStart),
                },
                {
                  header: wUnit,
                  cell: (r) =>
                    Math.round(toWeight(r.volumeKg)).toLocaleString(),
                },
                { header: t('performance.sets', 'Sets'), cell: (r) => r.sets },
              ]}
            >
              <TrendBarChart
                data={strength.weekly.map((w) => ({
                  ...w,
                  volume: Math.round(toWeight(w.volumeKg)),
                }))}
                xKey="weekStart"
                yKey="volume"
                name={wUnit}
                formatX={shortDate}
                formatValue={(v) =>
                  v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)
                }
              />
            </ChartCard>
            <ChartCard
              title={t('performance.topLifts', 'Estimated 1RM by lift')}
              subtitle={t('performance.e1rmNote', 'Epley, sets of 1–10 reps')}
              provenance={['estimated']}
              empty={strength.topLifts.length === 0}
              className="2xl:col-span-2"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">
                      {t('performance.exercise', 'Exercise')}
                    </th>
                    <th className="py-1 font-medium">e1RM</th>
                    <th className="py-1 font-medium">
                      {t('performance.date', 'Date')}
                    </th>
                    <th className="py-1 font-medium">
                      {t('performance.sets', 'Sets')}
                    </th>
                    <th className="w-1/3 py-1 font-medium">
                      {t('performance.trend', 'Trend')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {strength.topLifts.map((lift) => (
                    <tr
                      key={lift.exerciseName}
                      className="border-t border-border/60 tabular-nums"
                    >
                      <td className="py-1.5">{lift.exerciseName}</td>
                      <td className="py-1.5 font-medium">
                        {toWeight(lift.bestE1rmKg).toFixed(1)} {wUnit}
                      </td>
                      <td className="py-1.5">{shortDate(lift.bestDate)}</td>
                      <td className="py-1.5">{lift.sets}</td>
                      <td className="py-1">
                        {lift.trend.length > 1 ? (
                          <TrendLineChart
                            data={lift.trend.map((p) => ({
                              date: p.date,
                              value: Math.round(toWeight(p.value) * 10) / 10,
                            }))}
                            xKey="date"
                            series={[
                              {
                                key: 'value',
                                name: 'e1RM',
                                color: 'primary',
                                dots: true,
                              },
                            ]}
                            formatX={shortDate}
                            height={48}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            –
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartCard>
          </div>
        </section>
      )}

      {visible('load') && (
        <section id="perf-load" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.load}</h2>
          <div className={grid}>
            <ChartCard
              title={t('performance.acwrTitle', 'Acute:chronic load ratio')}
              subtitle={t(
                'performance.acwrNote',
                '7-day vs 28-day load; shaded band is 0.8–1.3'
              )}
              provenance={
                hasDeviceLoad ? ['device', 'estimated'] : ['estimated']
              }
              empty={loadRows.every(
                (r) => r.estimated === null && r.device === null
              )}
              className="md:col-span-2"
              rows={loadRows}
              columns={[
                {
                  header: t('performance.date', 'Date'),
                  cell: (r) => shortDate(r.date),
                },
                { header: 'Garmin', cell: (r) => r.device ?? '–' },
                {
                  header: t('performance.provenance.estimated', 'Estimated'),
                  cell: (r) => r.estimated ?? '–',
                },
              ]}
            >
              <SeriesLegend
                items={[
                  ...(hasDeviceLoad
                    ? [{ name: 'Garmin', color: 'primary' as const }]
                    : []),
                  {
                    name: t('performance.provenance.estimated', 'Estimated'),
                    color: hasDeviceLoad
                      ? ('secondary' as const)
                      : ('primary' as const),
                    dashed: true,
                  },
                ]}
              />
              <TrendLineChart
                data={loadRows}
                xKey="date"
                series={[
                  ...(hasDeviceLoad
                    ? [
                        {
                          key: 'device' as const,
                          name: 'Garmin',
                          color: 'primary' as const,
                          // Garmin reports the ratio only on synced days;
                          // markers keep isolated values visible.
                          dots: true,
                        },
                      ]
                    : []),
                  {
                    key: 'estimated' as const,
                    name: t('performance.provenance.estimated', 'Estimated'),
                    color: hasDeviceLoad
                      ? ('secondary' as const)
                      : ('primary' as const),
                    dashed: true,
                  },
                ]}
                formatX={shortDate}
                formatValue={(v) => v.toFixed(1)}
                band={{
                  from: 0.8,
                  to: 1.3,
                  label: t('performance.zone.optimalShort', 'optimal'),
                }}
                domain={[0, 'auto']}
              />
            </ChartCard>
          </div>
        </section>
      )}

      {visible('recovery') && (
        <section id="perf-recovery" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.recovery}</h2>
          <div className={grid}>
            {(
              [
                ['hrv', 'HRV (ms)', recovery.hrv],
                [
                  'rhr',
                  t('performance.restingHr', 'Resting heart rate (bpm)'),
                  recovery.restingHr,
                ],
              ] as const
            ).map(([key, title, metric]) => (
              <ChartCard
                key={key}
                title={title}
                subtitle={`${baselineLabel(metric.status.status)}${
                  metric.status.baseline !== null
                    ? ` · ${t('performance.baselineValue', 'baseline {{value}}', { value: metric.status.baseline })}`
                    : ''
                }`}
                provenance={['measured']}
                empty={metric.series.length === 0}
                rows={metric.series}
                columns={[
                  {
                    header: t('performance.date', 'Date'),
                    cell: (r) => shortDate(r.date),
                  },
                  { header: title, cell: (r) => r.value },
                ]}
              >
                <TrendLineChart
                  data={metric.series}
                  xKey="date"
                  series={[{ key: 'value', name: title, color: 'primary' }]}
                  formatX={shortDate}
                  band={
                    metric.status.baseline !== null &&
                    metric.status.baselineStdDev !== null
                      ? {
                          from:
                            metric.status.baseline -
                            metric.status.baselineStdDev,
                          to:
                            metric.status.baseline +
                            metric.status.baselineStdDev,
                          // Named in the card subtitle; an in-plot label
                          // would sit on top of the line.
                          label: '',
                        }
                      : null
                  }
                />
              </ChartCard>
            ))}
            <ChartCard
              title={t('performance.sleepDuration', 'Sleep duration (h)')}
              subtitle={
                recovery.sleep.meanBedtimeMinutes !== null
                  ? t(
                      'performance.bedtimeSummary',
                      'Typical bedtime {{time}}, ±{{minutes}} min',
                      {
                        time: formatClockMinutes(
                          recovery.sleep.meanBedtimeMinutes
                        ),
                        minutes: recovery.sleep.bedtimeStdDevMinutes,
                      }
                    )
                  : undefined
              }
              provenance={['measured']}
              empty={recovery.sleep.series.length === 0}
              rows={recovery.sleep.series}
              columns={[
                {
                  header: t('performance.date', 'Date'),
                  cell: (r) => shortDate(r.date),
                },
                { header: 'h', cell: (r) => r.hours },
                {
                  header: t('performance.score', 'Score'),
                  cell: (r) => r.score ?? '–',
                },
              ]}
            >
              <TrendBarChart
                data={recovery.sleep.series}
                xKey="date"
                yKey="hours"
                name="h"
                formatX={shortDate}
              />
            </ChartCard>
          </div>
        </section>
      )}

      {visible('nutrition') && (
        <section id="perf-nutrition" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.nutrition}</h2>
          {nutrition.averages.days > 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                'performance.nutritionAverages',
                'Average over {{days}} logged days: {{calories}} kcal · {{protein}} g protein · {{carbs}} g carbs · {{fat}} g fat',
                {
                  days: nutrition.averages.days,
                  calories: nutrition.averages.calories,
                  protein: nutrition.averages.protein,
                  carbs: nutrition.averages.carbs,
                  fat: nutrition.averages.fat,
                }
              )}
            </p>
          )}
          <div className={grid}>
            <ChartCard
              title={t('performance.calories', 'Calories (kcal)')}
              provenance={['measured']}
              empty={nutrition.daily.length === 0}
              rows={nutrition.daily}
              columns={[
                {
                  header: t('performance.date', 'Date'),
                  cell: (r) => shortDate(r.date),
                },
                { header: 'kcal', cell: (r) => r.calories },
                {
                  header: t('performance.protein', 'Protein'),
                  cell: (r) => r.protein,
                },
                {
                  header: t('performance.carbs', 'Carbs'),
                  cell: (r) => r.carbs,
                },
                { header: t('performance.fat', 'Fat'), cell: (r) => r.fat },
              ]}
            >
              <TrendBarChart
                data={nutrition.daily}
                xKey="date"
                yKey="calories"
                name="kcal"
                formatX={shortDate}
              />
            </ChartCard>
            <ChartCard
              title={t('performance.proteinTitle', 'Protein (g)')}
              provenance={['measured']}
              empty={nutrition.daily.length === 0}
            >
              <TrendBarChart
                data={nutrition.daily}
                xKey="date"
                yKey="protein"
                name="g"
                formatX={shortDate}
              />
            </ChartCard>
          </div>
        </section>
      )}

      {visible('body') && (
        <section id="perf-body" className="scroll-mt-4 space-y-3">
          <h2 className="text-lg font-semibold">{labels.body}</h2>
          <div className={grid}>
            <ChartCard
              title={t('performance.weight', 'Body weight ({{unit}})', {
                unit: wUnit,
              })}
              provenance={['measured']}
              empty={weightRows.length === 0}
              className="md:col-span-2"
              rows={weightRows}
              columns={[
                {
                  header: t('performance.date', 'Date'),
                  cell: (r) => shortDate(r.date),
                },
                { header: wUnit, cell: (r) => r.weight },
                {
                  header: t('performance.average7d', '7-day avg'),
                  cell: (r) => r.average,
                },
              ]}
            >
              <SeriesLegend
                items={[
                  {
                    name: t('performance.weighIns', 'Weigh-ins'),
                    color: 'primary',
                  },
                  {
                    name: t('performance.average7d', '7-day avg'),
                    color: 'secondary',
                  },
                ]}
              />
              <TrendLineChart
                data={weightRows}
                xKey="date"
                series={[
                  {
                    key: 'weight',
                    name: t('performance.weighIns', 'Weigh-ins'),
                    color: 'primary',
                    dots: true,
                  },
                  {
                    key: 'average',
                    name: t('performance.average7d', '7-day avg'),
                    color: 'secondary',
                  },
                ]}
                formatX={shortDate}
              />
            </ChartCard>
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        {t(
          'performance.methodsNote',
          '"Estimated" values are calculated by SparkyFitness (Epley 1RM, Riegel race times, 7/28-day load ratio, 60-day baselines, readiness heuristic). They are orientation, not medical advice. Details: Performance analytics in the documentation.'
        )}
      </p>
    </>
  );
}
