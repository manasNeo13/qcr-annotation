import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Skeleton,
  Table,
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
import { useListState } from '../hooks/useListState';
import type { EditField, FieldCounts, StatsFilter } from '../types';
import { colors } from '../theme';
import { formatDate, rangeLabel } from '../utils/format';
import { EDIT_FIELDS, FIELD_LABELS, pct } from '../utils/editStats';

const COLS: (EditField | 'any')[] = [...EDIT_FIELDS, 'any'];
const colLabel = (k: EditField | 'any') => (k === 'any' ? 'Any change' : FIELD_LABELS[k]);

/** One KPI tile: % big, count + bar below. */
function Tile({ label, n, total, strong }: { label: string; n: number; total: number; strong?: boolean }) {
  const share = total ? n / total : 0;
  return (
    <Paper
      sx={{
        p: 2,
        flex: '1 1 150px',
        minWidth: 0,
        border: `1px solid ${strong ? colors.brand100 : colors.border}`,
        bgcolor: strong ? colors.brandSoft : colors.paper,
        boxShadow: 'none',
      }}
    >
      <Typography sx={{ fontWeight: 700, color: strong ? colors.brandDark : colors.muted, fontSize: 13 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 700, color: colors.textDark, lineHeight: 1.2, mt: 0.5 }}>
        {pct(n, total)}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
        {n} of {total} images
      </Typography>
      <Box sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: colors.background, overflow: 'hidden' }}>
        <Box sx={{ height: 1, width: `${share * 100}%`, bgcolor: colors.primary, borderRadius: 3 }} />
      </Box>
    </Paper>
  );
}

/** "35.78%" with muted count under it. */
function PctCell({ n, total, strong }: { n: number; total: number; strong?: boolean }) {
  return (
    <TableCell align="right" sx={strong ? { bgcolor: colors.brandSoft } : undefined}>
      <Typography sx={{ fontWeight: strong ? 700 : 600, color: colors.textDark, lineHeight: 1.3 }}>
        {pct(n, total)}
      </Typography>
      <Typography sx={{ fontSize: 12, color: colors.muted, lineHeight: 1.3 }}>{n}</Typography>
    </TableCell>
  );
}

function CountCells({ c, total }: { c: FieldCounts; total: number }) {
  return (
    <>
      {COLS.map((k) => (
        <PctCell key={k} n={c[k]} total={total} strong={k === 'any'} />
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

const HeadCols = () => (
  <>
    {COLS.map((k) => (
      <TableCell key={k} align="right">
        {colLabel(k)}
      </TableCell>
    ))}
  </>
);

/** Edit stats: how often annotators corrected OCR values. Capture day (IST), all images = denominator. */
export default function StatsPage() {
  const state = useListState();
  const { filter, latest, needDefaultDate, setRange } = state;
  const sf: StatsFilter = { from: filter.from, to: filter.to, client: filter.client };
  const [exportOpen, setExportOpen] = useState(false);

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
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 2.5, mb: 1.25, flexWrap: 'wrap' }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {total} images
              </Typography>
              <Typography sx={{ color: colors.muted }}>captured {rangeLabel(filter.from, filter.to)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {EDIT_FIELDS.map((k) => (
                <Tile key={k} label={FIELD_LABELS[k]} n={data.changed[k]} total={total} />
              ))}
              <Tile label="Any change" n={data.changed.any} total={total} strong />
            </Box>

            <Section title="By annotator" hint="% of images each person handled where they changed that field">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Annotator</TableCell>
                    <TableCell align="right">Images handled</TableCell>
                    <HeadCols />
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
                        <CountCells c={a.changed} total={a.images} />
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Section>

            {data.byDay.length > 1 && (
              <Section title="By capture day" hint="% of that day's images with the field changed">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Capture day</TableCell>
                      <TableCell align="right">Total images</TableCell>
                      <HeadCols />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...data.byDay].reverse().map((d) => (
                      <TableRow key={d.date} hover>
                        <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {formatDate(d.date)}
                        </TableCell>
                        <TableCell align="right">{d.total}</TableCell>
                        <CountCells c={d.changed} total={d.total} />
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
