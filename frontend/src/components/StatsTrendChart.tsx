/**
 * Edit Stats trend: one line per source (Overall / Dashboard / SDK) per capture day.
 * Own field picker; client + Accuracy / Edit % follow the page.
 * Range = page range; single day (or open-ended) → last 30 days ending on that day.
 * Plain SVG (no chart library): crosshair + tooltip on hover, legend + end labels.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Box,
  LinearProgress,
  Paper,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { api } from '../api';
import type { EditKey, StatsFilter } from '../types';
import { colors } from '../theme';
import { clientLabel } from '../utils/clients';
import { EDIT_FIELDS, FIELD_LABELS } from '../utils/editStats';
import { rangeLabel } from '../utils/format';

type Mode = 'accuracy' | 'edit';
type SeriesKey = 'overall' | 'dashboard' | 'sdk';

/** Validated categorical slots 1–3 (all-pairs CVD safe). Aqua < 3:1 → end labels always shown. */
const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'overall', label: 'Overall', color: '#2a78d6' },
  { key: 'dashboard', label: 'Dashboard', color: '#eb6834' },
  { key: 'sdk', label: 'SDK', color: '#1baf7a' },
];

const H = 280;
const M = { top: 16, right: 84, bottom: 30, left: 44 };
const fmtDay = (d: string) => dayjs(d).format('DD MMM');

/** Single day / open range → 30 days ending there. */
function chartRange(from?: string, to?: string): { from?: string; to?: string } {
  if (!from) return {};
  const end = to ?? from;
  if (end !== from) return { from, to: end };
  return { from: dayjs(end).subtract(29, 'day').format('YYYY-MM-DD'), to: end };
}

interface Point {
  date: string;
  total: number;
  values: Record<SeriesKey, number>;
}

export default function StatsTrendChart({ mode, pageFilter }: { mode: Mode; pageFilter: StatsFilter }) {
  const [field, setField] = useState<EditKey>('any');
  const client = pageFilter.client;

  const range = chartRange(pageFilter.from, pageFilter.to);
  const cf: StatsFilter = { ...range, client };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['edit-stats', cf],
    queryFn: () => api.getStats(cf),
    placeholderData: keepPreviousData,
  });

  const points: Point[] = useMemo(
    () =>
      (data?.byDay ?? []).map((d) => {
        const v = (n: number) => (d.total ? ((mode === 'edit' ? n : d.total - n) / d.total) * 100 : 0);
        return {
          date: d.date,
          total: d.total,
          values: {
            overall: v(d.changed[field]),
            dashboard: v(d.bySource?.dashboard[field] ?? 0),
            sdk: v(d.bySource?.sdk[field] ?? 0),
          },
        };
      }),
    [data, mode, field],
  );

  const fieldLabel = field === 'any' ? (mode === 'edit' ? 'Any change' : 'All fields') : FIELD_LABELS[field];

  return (
    <Paper sx={{ overflow: 'hidden', mt: 2 }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
          <Typography variant="h5">{mode === 'edit' ? 'Edit % trend' : 'Accuracy trend'}</Typography>
          <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
            {fieldLabel} · {client ? clientLabel(client) : 'All clients'} · {rangeLabel(range.from, range.to)}
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={field}
          onChange={(_, v: EditKey | null) => v && setField(v)}
          aria-label="Field"
          sx={{ flexWrap: 'wrap' }}
        >
          {EDIT_FIELDS.map((k) => (
            <ToggleButton key={k} value={k}>
              {FIELD_LABELS[k]}
            </ToggleButton>
          ))}
          <ToggleButton value="any">{mode === 'edit' ? 'Any change' : 'All fields'}</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ height: 3 }}>{isFetching && !isLoading && <LinearProgress sx={{ height: 3 }} />}</Box>

      <Box sx={{ px: 2, pb: 2 }}>
        <Legend />
        {isLoading ? (
          <Skeleton variant="rounded" height={H} />
        ) : !points.length ? (
          <Box sx={{ height: H, display: 'grid', placeItems: 'center', color: colors.muted }}>
            <Typography>No captures in this range.</Typography>
          </Box>
        ) : (
          <Plot points={points} mode={mode} />
        )}
      </Box>
    </Paper>
  );
}

function Legend() {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', py: 1.25 }}>
      {SERIES.map((s) => (
        <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 13, color: colors.textPrimary }}>
          <Box sx={{ width: 14, height: 3, borderRadius: 2, bgcolor: s.color }} />
          {s.label}
        </Box>
      ))}
    </Box>
  );
}

/** Nice y bounds: accuracy usually sits near 100 → zoom to the data, steps of 5. */
function yDomain(points: Point[]): [number, number] {
  const all = points.flatMap((p) => SERIES.map((s) => p.values[s.key]));
  let lo = Math.floor(Math.min(...all) / 5) * 5;
  let hi = Math.ceil(Math.max(...all) / 5) * 5;
  if (hi - lo < 5) {
    if (hi >= 100) lo = hi - 5;
    else hi = lo + 5;
  }
  lo = Math.max(0, lo);
  hi = Math.min(100, hi);
  return [lo, hi];
}

function Plot({ points, mode }: { points: Point[]; mode: Mode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = w - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const t0 = dayjs(points[0].date);
  const span = Math.max(1, dayjs(points[points.length - 1].date).diff(t0, 'day'));
  const x = (d: string) => M.left + (points.length === 1 ? iw / 2 : (dayjs(d).diff(t0, 'day') / span) * iw);
  const [lo, hi] = yDomain(points);
  const y = (v: number) => M.top + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  // X labels: at most ~6, evenly picked from the points.
  const step = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 90))));
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  // End labels: last value per series, nudged apart (≥ 14px).
  const last = points[points.length - 1];
  const ends = SERIES.map((s) => ({ ...s, v: last.values[s.key], y: y(last.values[s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left + M.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  const hx = hp ? x(hp.date) : 0;
  const fmtV = (v: number) => `${v.toFixed(2)}%`;

  return (
    <Box ref={wrap} sx={{ position: 'relative', width: '100%' }}>
      <svg width={w} height={H} role="img" aria-label={`${mode === 'edit' ? 'Edit %' : 'Accuracy'} per capture day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={colors.muted}>
              {Number.isInteger(t) ? t : t.toFixed(1)}%
            </text>
          </g>
        ))}
        {xLabels.map((p) => (
          <text key={p.date} x={x(p.date)} y={H - 8} textAnchor="middle" fontSize={11} fill={colors.muted}>
            {fmtDay(p.date)}
          </text>
        ))}

        {hp && <line x1={hx} x2={hx} y1={M.top} y2={M.top + ih} stroke={colors.borderStrong} strokeWidth={1} />}

        {SERIES.map((s) => (
          <g key={s.key}>
            {points.length > 1 && (
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points.map((p) => `${x(p.date)},${y(p.values[s.key])}`).join(' ')}
              />
            )}
            {(points.length <= 31 || points.length === 1) &&
              points.map((p, i) => (
                <circle
                  key={p.date}
                  cx={x(p.date)}
                  cy={y(p.values[s.key])}
                  r={hover === i ? 5 : 3.5}
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
          </g>
        ))}
        {hp &&
          points.length > 31 &&
          SERIES.map((s) => (
            <circle key={s.key} cx={hx} cy={y(hp.values[s.key])} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />
          ))}

        {ends.map((e) => (
          <text key={e.key} x={x(last.date) + 10} y={e.y} dy="0.32em" fontSize={11.5} fill={colors.textPrimary}>
            {e.label} {e.v.toFixed(1)}%
          </text>
        ))}

        <rect
          x={M.left}
          y={M.top}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hp && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: hx > w - 200 ? Math.max(hx - 192, 0) : hx + 12,
            width: 180,
            pointerEvents: 'none',
            bgcolor: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 1.5,
            boxShadow: '0 6px 20px rgba(15,23,42,.12)',
            px: 1.25,
            py: 1,
            fontSize: 12.5,
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: colors.textDark }}>
            {dayjs(hp.date).format('DD MMM YYYY')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: colors.muted, mb: 0.5 }}>{hp.total} images</Typography>
          {SERIES.map((s) => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
              <Box sx={{ flex: 1, color: colors.textPrimary }}>{s.label}</Box>
              <Box sx={{ fontWeight: 700, color: colors.textDark }}>{fmtV(hp.values[s.key])}</Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
