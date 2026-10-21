import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2, LineChart as LineChartIcon } from 'lucide-react';
import type { Provenance } from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSeriesColors } from '@/hooks/Performance/useSeriesColors';

const axisProps = {
  stroke: 'hsl(var(--border))',
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
  tickLine: false,
} as const;

const tooltipStyle = {
  backgroundColor: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  color: 'hsl(var(--foreground))',
  fontSize: 12,
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const { t } = useTranslation();
  const label = {
    measured: t('performance.provenance.measured', 'Measured'),
    device: t('performance.provenance.device', 'Device'),
    estimated: t('performance.provenance.estimated', 'Estimated'),
  }[provenance];
  const style = {
    measured: 'border-border text-foreground',
    device: 'border-border text-muted-foreground',
    estimated: 'border-dashed border-border text-muted-foreground italic',
  }[provenance];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}
      title={t(
        `performance.provenance.${provenance}Help`,
        provenance === 'measured'
          ? 'Recorded by a device or logged by you'
          : provenance === 'device'
            ? 'Computed by your wearable vendor (e.g. Garmin)'
            : 'Calculated by SparkyFitness; see the methods note'
      )}
    >
      {label}
    </span>
  );
}

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

/** Card with a title, provenance badges and a chart/table toggle. */
export function ChartCard<T>({
  title,
  provenance,
  subtitle,
  children,
  rows,
  columns,
  empty,
  className = '',
}: {
  title: string;
  provenance: Provenance[];
  subtitle?: ReactNode;
  children: ReactNode;
  rows?: T[];
  columns?: TableColumn<T>[];
  empty?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={`flex flex-col ${className}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {subtitle && (
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {provenance.map((p) => (
            <ProvenanceBadge key={p} provenance={p} />
          ))}
          {rows && columns && !empty && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={
                asTable
                  ? t('performance.showChart', 'Show chart')
                  : t('performance.showTable', 'Show table')
              }
              onClick={() => setAsTable((v) => !v)}
            >
              {asTable ? (
                <LineChartIcon className="h-4 w-4" />
              ) : (
                <Table2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('performance.noData', 'No data in this range')}
          </p>
        ) : asTable && rows && columns ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.header}
                      className="py-1 pr-3 text-left font-medium text-muted-foreground"
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-border/60">
                    {columns.map((c) => (
                      <td key={c.header} className="py-1 pr-3 tabular-nums">
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

type Row = Record<string, unknown>;

export function TrendBarChart({
  data,
  xKey,
  yKey,
  name,
  formatX,
  formatValue,
  height = 220,
}: {
  data: Row[];
  xKey: string;
  yKey: string;
  name: string;
  formatX?: (v: string) => string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const colors = useSeriesColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="hsl(var(--border))"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey={xKey}
          {...axisProps}
          tickFormatter={formatX}
          minTickGap={16}
        />
        <YAxis
          {...axisProps}
          axisLine={false}
          width={44}
          tickFormatter={formatValue}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          contentStyle={tooltipStyle}
          labelFormatter={(l) => (formatX ? formatX(String(l)) : String(l))}
          formatter={(v) => [
            formatValue ? formatValue(Number(v)) : String(v),
            name,
          ]}
        />
        <Bar
          dataKey={yKey}
          name={name}
          fill={colors.primary}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface LineSeries {
  key: string;
  name: string;
  color: 'primary' | 'secondary';
  dashed?: boolean;
  dots?: boolean;
}

export function TrendLineChart({
  data,
  xKey,
  series,
  formatX,
  formatValue,
  band,
  reversed,
  domain,
  height = 220,
  tooltipValue,
}: {
  data: Row[];
  xKey: string;
  series: LineSeries[];
  formatX?: (v: string) => string;
  formatValue?: (v: number) => string;
  /** Shaded reference range, e.g. a personal baseline or the optimal ACWR zone. */
  band?: { from: number; to: number; label: string } | null;
  /** Lower is better (pace): draw smaller values higher. */
  reversed?: boolean;
  domain?: [
    number | 'auto' | 'dataMin' | 'dataMax',
    number | 'auto' | 'dataMin' | 'dataMax',
  ];
  height?: number;
  /** Tooltip text from the row instead of the plotted value (e.g. normalized lines). */
  tooltipValue?: (row: Row, seriesKey: string) => string;
}) {
  const colors = useSeriesColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="hsl(var(--border))"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey={xKey}
          {...axisProps}
          tickFormatter={formatX}
          minTickGap={24}
        />
        <YAxis
          {...axisProps}
          axisLine={false}
          width={48}
          reversed={reversed}
          domain={domain ?? ['auto', 'auto']}
          tickFormatter={formatValue}
        />
        {band && (
          <ReferenceArea
            y1={band.from}
            y2={band.to}
            fill="hsl(var(--muted-foreground))"
            fillOpacity={0.12}
            stroke="none"
            ifOverflow="extendDomain"
            label={{
              value: band.label,
              position: 'insideTopLeft',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 11,
            }}
          />
        )}
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(l) => (formatX ? formatX(String(l)) : String(l))}
          formatter={(v, n, item) => [
            tooltipValue && item?.payload && item.dataKey !== undefined
              ? tooltipValue(item.payload as Row, String(item.dataKey))
              : formatValue
                ? formatValue(Number(v))
                : String(v),
            String(n),
          ]}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={colors[s.color]}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            dot={
              s.dots ? { r: 3, strokeWidth: 0, fill: colors[s.color] } : false
            }
            activeDot={{
              r: 5,
              stroke: 'hsl(var(--background))',
              strokeWidth: 2,
            }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Legend for multi-series charts: identity is never color alone. */
export function SeriesLegend({
  items,
}: {
  items: { name: string; color: 'primary' | 'secondary'; dashed?: boolean }[];
}) {
  const colors = useSeriesColors();
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke={colors[item.color]}
              strokeWidth="2"
              strokeDasharray={item.dashed ? '4 3' : undefined}
            />
          </svg>
          {item.name}
        </span>
      ))}
    </div>
  );
}
