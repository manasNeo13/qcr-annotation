import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Skeleton,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import DateRangeFilter from '../components/DateRangeFilter';
import ExportStatsDialog from '../components/ExportStatsDialog';
import { ScopeFilters } from '../components/ListToolbar';
import PageBreadcrumbs from '../components/PageBreadcrumbs';
import { carryParams, useListState } from '../hooks/useListState';
import type { EditField, EditKey, EditSource, FieldCounts, StatsFilter } from '../types';
import { colors } from '../theme';
import { formatDate, rangeLabel } from '../utils/format';
import { EDIT_FIELDS, FIELD_LABELS, SOURCE_LABELS, accuracy, pct } from '../utils/editStats';

const COLS: (EditField | 'any')[] = [...EDIT_FIELDS, 'any'];

/** View mode: accuracy (images NOT edited) or edit % (images edited). Accuracy = 100% − Edit %. */
type Mode = 'accuracy' | 'edit';
const MODE_KEY = 'nq-stats-mode';
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'accuracy';
  } catch {
    return 'accuracy';
  }
};
const fmt = (mode: Mode, n: number, total: number) => (mode === 'edit' ? pct(n, total) : accuracy(n, total));
const colLabel = (k: EditField | 'any') => (k === 'any' ? 'Any change' : FIELD_LABELS[k]);

/** Drill-down target: Filter Table of images where `changed` was edited (optionally by editor / on day). */
type LinkFor = (changed: EditKey) => string;
function drillLink(params: URLSearchParams, { day, editor }: { day?: string; editor?: string } = {}): LinkFor {
  return (changed) => {
    const qs = carryParams(params, ['q', 'status', 'changed', 'editor']);
    if (day) {
      qs.set('from', day);
      qs.delete('to');
      qs.delete('all');
    } else if (!qs.get('from')) qs.set('all', '1'); // stats over all dates → list too (skip default day)
    qs.set('changed', changed);
    if (editor) qs.set('editor', editor);
    return `/documents?${qs}`;
  };
}

const linkSx = {
  display: 'block',
  textDecoration: 'none',
  color: 'inherit',
  borderRadius: '6px',
  transition: 'background .15s',
  '&:hover, &:focus-visible': { bgcolor: colors.surface2 },
  '&:hover .nq-pct, &:focus-visible .nq-pct': { color: colors.brandDark, textDecoration: 'underline' },
};

/** One KPI tile: overall accuracy big, edited count + bar, Dashboard / SDK accuracy below. Click → drill-down (when any). */
function Tile({
  label,
  n,
  total,
  sources,
  mode,
  strong,
  to,
}: {
  mode: Mode;
  label: string;
  n: number;
  total: number;
  sources: Record<EditSource, number>;
  strong?: boolean;
  to?: string;
}) {
  const share = total ? (mode === 'edit' ? n : total - n) / total : 0;
  const clickable = !!to && n > 0;
  const link = clickable ? { component: RouterLink, to, 'aria-label': `View ${n} images: ${label} edited` } : {};
  return (
    <Paper
      {...link}
      sx={{
        p: 2,
        flex: '1 1 170px',
        minWidth: 0,
        border: `1px solid ${strong ? colors.brand100 : colors.border}`,
        bgcolor: strong ? colors.brandSoft : colors.paper,
        boxShadow: 'none',
        textDecoration: 'none',
        ...(clickable
          ? {
              transition: 'border-color .15s, box-shadow .15s',
              '&:hover, &:focus-visible': { borderColor: colors.primary, boxShadow: `0 0 0 1px ${colors.primary}` },
              '&:hover .nq-pct, &:focus-visible .nq-pct': { color: colors.brandDark },
            }
          : {}),
      }}
    >
      <Typography sx={{ fontWeight: 700, color: strong ? colors.brandDark : colors.muted, fontSize: 13 }}>
        {label} {mode === 'edit' ? 'edit %' : 'accuracy'}
      </Typography>
      <Typography
        className="nq-pct"
        sx={{ fontSize: 28, fontWeight: 700, color: colors.textDark, lineHeight: 1.2, mt: 0.5 }}
      >
        {fmt(mode, n, total)}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
        {n} of {total} edited
      </Typography>
      <Box sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: colors.background, overflow: 'hidden' }}>
        <Box sx={{ height: 1, width: `${share * 100}%`, bgcolor: colors.primary, borderRadius: 3 }} />
      </Box>
      <Box
        sx={{
          mt: 1.25,
          pt: 1,
          borderTop: `1px solid ${strong ? colors.brand100 : colors.border}`,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1,
        }}
      >
        {(Object.keys(SOURCE_LABELS) as EditSource[]).map((src) => (
          <Box key={src} sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 11.5, color: colors.muted, lineHeight: 1.3 }}>{SOURCE_LABELS[src]}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: colors.textDark, lineHeight: 1.3 }}>
              {fmt(mode, sources[src], total)}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: colors.muted, lineHeight: 1.3 }}>{sources[src]} edited</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

/** "35.78%" with muted count under it. Click → drill-down (when any). */
function PctCell({ n, total, strong, to, mode }: { n: number; total: number; strong?: boolean; to?: string; mode: Mode }) {
  const clickable = !!to && n > 0;
  const body = (
    <>
      <Typography className="nq-pct" sx={{ fontWeight: strong ? 700 : 600, color: colors.textDark, lineHeight: 1.3 }}>
        {fmt(mode, n, total)}
      </Typography>
      <Typography sx={{ fontSize: 12, color: colors.muted, lineHeight: 1.3 }}>{n} edited</Typography>
    </>
  );
  return (
    <TableCell align="right" sx={{ ...(strong ? { bgcolor: colors.brandSoft } : {}), ...(clickable ? { p: 0.5 } : {}) }}>
      {clickable ? (
        <Box component={RouterLink} to={to} aria-label={`View ${n} images`} sx={{ ...linkSx, px: 1.5, py: 0.5 }}>
          {body}
        </Box>
      ) : (
        body
      )}
    </TableCell>
  );
}

function CountCells({ c, total, linkFor, mode }: { c: FieldCounts; total: number; linkFor: LinkFor; mode: Mode }) {
  return (
    <>
      {COLS.map((k) => (
        <PctCell key={k} n={c[k]} total={total} strong={k === 'any'} to={linkFor(k)} mode={mode} />
      ))}
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ overflow: 'hidden', mt: 2 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
        <Typography variant="h5">{title}</Typography>
        <Typography sx={{ fontSize: 12.5, color: colors.muted }}>{hint}</Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }}>{children}</TableContainer>
    </Paper>
  );
}

const HeadCols = ({ mode }: { mode: Mode }) => (
  <>
    {COLS.map((k) => (
      <TableCell key={k} align="right">
        {mode === 'accuracy' && k === 'any' ? 'All fields' : colLabel(k)}
      </TableCell>
    ))}
  </>
);

/** Edit stats: OCR accuracy (images not edited) overall + per source (Dashboard / SDK). Capture day (IST), all images = denominator. */
export default function StatsPage() {
  const state = useListState();
  const { params, filter, latest, needDefaultDate, setRange } = state;
  const sf: StatsFilter = { from: filter.from, to: filter.to, client: filter.client };
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: keep in memory only */
    }
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['edit-stats', sf],
    queryFn: () => api.getStats(sf),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });

  const total = data?.total ?? 0;
  const loading = isLoading || needDefaultDate;

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={[{ label: 'Edit Stats' }]} />

      <Paper sx={{ overflow: 'hidden' }}>
        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <DateRangeFilter from={filter.from} to={filter.to} latest={latest} scope={state.scope} onChange={setRange} />
          <ScopeFilters state={state} />
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<DownloadIcon />}
            onClick={() => setExportOpen(true)}
            disabled={!data || !total}
          >
            Export CSV
          </Button>
        </Box>
        <Box sx={{ height: 3 }}>{isFetching && !isLoading && <LinearProgress sx={{ height: 3 }} />}</Box>
      </Paper>

      {isError ? (
        <Alert
          severity="error"
          sx={{ mt: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {(error as Error)?.message || 'Could not load stats.'}
        </Alert>
      ) : loading ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={124} sx={{ flex: '1 1 150px' }} />
          ))}
        </Box>
      ) : !total ? (
        <Paper sx={{ mt: 2, py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
          <InboxIcon sx={{ fontSize: 48, color: colors.subtle }} />
          <Typography variant="h5" sx={{ mt: 1 }}>
            No captures in this range
          </Typography>
          <Typography>Pick another date or client.</Typography>
        </Paper>
      ) : (
        data && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 2.5, mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {total} images
              </Typography>
              <Typography sx={{ color: colors.muted }}>captured {rangeLabel(filter.from, filter.to)}</Typography>
              <Box sx={{ flex: 1 }} />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={mode}
                onChange={(_, v: Mode | null) => v && setMode(v)}
                aria-label="Show accuracy or edit percentage"
              >
                <ToggleButton value="accuracy">Accuracy</ToggleButton>
                <ToggleButton value="edit">Edit %</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Typography sx={{ fontSize: 12.5, color: colors.muted, mb: 1.25 }}>
              {mode === 'edit'
                ? 'Edit % = images where the OCR value was edited ÷ total images. Accuracy = 100% − Edit %.'
                : 'Accuracy = images where the OCR value was not edited ÷ total images (100% − Edit %).'}{' '}
              Top = overall (final value ≠ OCR). Dashboard / SDK = edits made by that source.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {EDIT_FIELDS.map((k) => (
                <Tile
                  key={k}
                  label={FIELD_LABELS[k]}
                  n={data.changed[k]}
                  total={total}
                  sources={{ dashboard: data.bySource.dashboard[k], sdk: data.bySource.sdk[k] }}
                  mode={mode}
                  to={drillLink(params)(k)}
                />
              ))}
              <Tile
                label={mode === 'edit' ? 'Any change' : 'All fields'}
                n={data.changed.any}
                total={total}
                sources={{ dashboard: data.bySource.dashboard.any, sdk: data.bySource.sdk.any }}
                mode={mode}
                strong
                to={drillLink(params)('any')}
              />
            </Box>

            <Section
              title="By annotator"
              hint={
                mode === 'edit'
                  ? '% of images each person handled where they changed that field'
                  : '% of images each person handled where they did not change that field'
              }
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Annotator</TableCell>
                    <TableCell align="right">Images handled</TableCell>
                    <HeadCols mode={mode} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.annotators.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2 + COLS.length} sx={{ py: 4, textAlign: 'center', color: colors.muted }}>
                        No edits yet in this range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.annotators.map((a) => (
                      <TableRow key={a.name} hover>
                        <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {a.name}
                        </TableCell>
                        <TableCell align="right">{a.images}</TableCell>
                        <CountCells c={a.changed} total={a.images} linkFor={drillLink(params, { editor: a.name })} mode={mode} />
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Section>

            {data.byDay.length > 1 && (
              <Section title="By capture day" hint={
                  mode === 'edit'
                    ? "% of that day's images with the field edited"
                    : "% of that day's images where the OCR value was not edited"
                }>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Capture day</TableCell>
                      <TableCell align="right">Total images</TableCell>
                      <HeadCols mode={mode} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...data.byDay].reverse().map((d) => (
                      <TableRow key={d.date} hover>
                        <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {formatDate(d.date)}
                        </TableCell>
                        <TableCell align="right">{d.total}</TableCell>
                        <CountCells c={d.changed} total={d.total} linkFor={drillLink(params, { day: d.date })} mode={mode} />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )}
          </>
        )
      )}

      <ExportStatsDialog open={exportOpen} onClose={() => setExportOpen(false)} filter={sf} stats={data} />
    </Box>
  );
}
