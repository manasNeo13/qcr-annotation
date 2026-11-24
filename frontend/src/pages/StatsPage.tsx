import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  IconButton,
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
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/EditNoteOutlined';
import { api } from '../api';
import { useAccess } from '../auth/useAccess';
import DateRangeFilter from '../components/DateRangeFilter';
import DocumentTable from '../components/DocumentTable';
import ExportStatsDialog from '../components/ExportStatsDialog';
import StatsTrendChart from '../components/StatsTrendChart';
import { ScopeFilters } from '../components/ListToolbar';
import PageBreadcrumbs from '../components/PageBreadcrumbs';
import { readDay, useListState, type ListState } from '../hooks/useListState';
import type { EditField, EditKey, EditSource, FieldCounts, StatsFilter } from '../types';
import { colors } from '../theme';
import { formatDate, rangeLabel } from '../utils/format';
import { EDIT_FIELDS, FIELD_LABELS, SOURCE_LABELS, accuracy, editLabel, pct } from '../utils/editStats';

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

/** Drill-down selection: images where `changed` was edited, optionally by editor / on one capture day. */
interface Drill {
  changed: EditKey;
  editor?: string;
  day?: string;
}
const sameDrill = (a: Drill | null, b: Drill) =>
  !!a && a.changed === b.changed && (a.editor ?? '') === (b.editor ?? '') && (a.day ?? '') === (b.day ?? '');

/** Open drill-down + how to open another. */
interface DrillCtl {
  active: Drill | null;
  open: (d: Drill) => void;
}

const PAGE_SIZE = 15;

const linkSx = {
  display: 'block',
  width: '100%',
  textAlign: 'right',
  font: 'inherit',
  color: 'inherit',
  borderRadius: '6px',
  transition: 'background .15s',
  '&:hover, &:focus-visible': { bgcolor: colors.surface2 },
  '&:hover .nq-pct, &:focus-visible .nq-pct': { color: colors.brandDark, textDecoration: 'underline' },
};

/** One KPI tile: overall accuracy big, edited count + bar, Dashboard / SDK accuracy below. Click → results section below (when any). */
function Tile({
  label,
  n,
  total,
  sources,
  mode,
  strong,
  onClick,
  active,
}: {
  mode: Mode;
  label: string;
  n: number;
  total: number;
  sources: Record<EditSource, number>;
  strong?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const share = total ? (mode === 'edit' ? n : total - n) / total : 0;
  const clickable = !!onClick && n > 0;
  const btn = clickable
    ? { component: ButtonBase, onClick, 'aria-label': `View ${n} images: ${label} edited`, 'aria-pressed': !!active }
    : {};
  return (
    <Paper
      {...btn}
      sx={{
        p: 2,
        flex: '1 1 170px',
        minWidth: 0,
        display: 'block',
        textAlign: 'left',
        border: `1px solid ${active ? colors.primary : strong ? colors.brand100 : colors.border}`,
        bgcolor: strong ? colors.brandSoft : colors.paper,
        boxShadow: active ? `0 0 0 1px ${colors.primary}` : 'none',
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

/** "35.78%" with muted count under it. Click → results section below (when any). */
function PctCell({
  n,
  total,
  strong,
  onClick,
  active,
  mode,
}: {
  n: number;
  total: number;
  strong?: boolean;
  onClick?: () => void;
  active?: boolean;
  mode: Mode;
}) {
  const clickable = !!onClick && n > 0;
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
        <ButtonBase
          onClick={onClick}
          aria-label={`View ${n} images`}
          aria-pressed={!!active}
          sx={{
            ...linkSx,
            px: 1.5,
            py: 0.5,
            ...(active ? { bgcolor: colors.brandSoft, boxShadow: `inset 0 0 0 1px ${colors.primary}` } : {}),
          }}
        >
          {body}
        </ButtonBase>
      ) : (
        body
      )}
    </TableCell>
  );
}

function CountCells({
  c,
  total,
  drill,
  scope,
  mode,
}: {
  c: FieldCounts;
  total: number;
  drill: DrillCtl;
  scope: Omit<Drill, 'changed'>;
  mode: Mode;
}) {
  return (
    <>
      {COLS.map((k) => {
        const d = { ...scope, changed: k };
        return (
          <PctCell
            key={k}
            n={c[k]}
            total={total}
            strong={k === 'any'}
            onClick={() => drill.open(d)}
            active={sameDrill(drill.active, d)}
            mode={mode}
          />
        );
      })}
    </>
  );
}

/** Drill-down results under the stats: same table as Filter Table (edit-filtered), no search/status. Row → detail page. */
function DrillSection({
  drill,
  state,
  onClose,
  sectionRef,
}: {
  drill: Drill;
  state: ListState;
  onClose: () => void;
  sectionRef: React.RefObject<HTMLDivElement | null>;
}) {
  const navigate = useNavigate();
  const { params, filter, page, needDefaultDate, update } = state;
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: '',
    status: 'all' as const,
    client: filter.client,
    from: drill.day ?? filter.from,
    to: drill.day ?? filter.to,
    changed: drill.changed,
    editor: drill.editor,
  };
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['documents', 'edited', query],
    queryFn: () => api.listEdited(query),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });
  // Detail page reads the same params → prev/next inside this list, Back returns here.
  const open = (id: string) => navigate(`/documents/${encodeURIComponent(id)}?${params}`);
  const when = drill.day ? formatDate(drill.day) : rangeLabel(filter.from, filter.to);

  return (
    <Paper ref={sectionRef} className="nq-fade-up" sx={{ overflow: 'hidden', mt: 2, scrollMarginTop: 16 }}>
      <Box
        sx={{
          px: { xs: 1.5, sm: 2 },
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          borderBottom: `1px solid ${colors.border}`,
          bgcolor: colors.brandSoft,
        }}
      >
        <EditIcon sx={{ color: colors.brandDark }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5">{editLabel(drill.changed, drill.editor)}</Typography>
          <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
            {data ? `${data.total} images · ` : ''}captured {when} ·{' '}
            {drill.editor ? 'images where this annotator changed the field' : 'images where final value ≠ original OCR'}
          </Typography>
        </Box>
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="Close results">
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <DocumentTable
        data={data}
        isLoading={isLoading || needDefaultDate}
        isFetching={isFetching}
        isError={isError}
        error={error}
        refetch={refetch}
        page={page}
        pageSize={PAGE_SIZE}
        onPage={(p) => {
          update({ page: p });
          sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onOpen={open}
        showEdits
        keepScroll
      />
    </Paper>
  );
}

function Section({
  title,
  hint,
  children,
  footer,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Paper sx={{ overflow: 'hidden', mt: 2 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
        <Typography variant="h5">{title}</Typography>
        <Typography sx={{ fontSize: 12.5, color: colors.muted }}>{hint}</Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }}>{children}</TableContainer>
      {footer}
    </Paper>
  );
}

/** Annotator / day tables: 10 rows per page (client side). */
const TABLE_PAGE = 10;
const pageOf = (index: number) => Math.floor(Math.max(0, index) / TABLE_PAGE) + 1;
const slice = <T,>(rows: T[], page: number) => rows.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);

function TablePager({ count, page, onPage }: { count: number; page: number; onPage: (p: number) => void }) {
  if (count <= TABLE_PAGE) return null;
  return (
    <TablePagination
      component="div"
      count={count}
      page={Math.min(page - 1, Math.ceil(count / TABLE_PAGE) - 1)}
      rowsPerPage={TABLE_PAGE}
      rowsPerPageOptions={[]}
      onPageChange={(_, p) => onPage(p + 1)}
      sx={{ borderTop: `1px solid ${colors.border}`, '.MuiTablePagination-toolbar': { px: { xs: 1, sm: 2 } } }}
    />
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
  const { can } = useAccess();
  const { params, filter, latest, needDefaultDate, setRange, update } = state;
  // Open drill-down lives in URL (changed/editor/day/page) → survives detail page round-trip.
  const active: Drill | null = filter.changed
    ? { changed: filter.changed, editor: filter.editor, day: readDay(params) }
    : null;
  const drillKey = active ? `${active.changed}|${active.editor ?? ''}|${active.day ?? ''}` : '';
  const sectionRef = useRef<HTMLDivElement>(null);
  const drill: DrillCtl = {
    active,
    open: (d) => update({ changed: d.changed, editor: d.editor ?? null, day: d.day ?? null, page: 1 }),
  };
  const closeDrill = () => update({ changed: null, editor: null, day: null, page: null });
  // Day drill only makes sense inside the range → new range drops it.
  const onRange = (a?: string, b?: string) => setRange(a, b, { day: null });
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

  // Results open right under the block that was clicked.
  const where = active ? (active.day ? 'day' : active.editor ? 'annotator' : 'kpi') : null;
  const days = data ? [...data.byDay].reverse() : [];
  const people = data?.annotators ?? [];
  const [dayPage, setDayPage] = useState(1);
  const [peoplePage, setPeoplePage] = useState(1);
  // Keep the picked row visible (e.g. back from detail page); new range → page 1.
  useEffect(() => {
    setDayPage(active?.day ? pageOf(days.findIndex((d) => d.date === active.day)) : 1);
    setPeoplePage(active?.editor ? pageOf(people.findIndex((a) => a.name === active.editor)) : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, active?.day, active?.editor]);
  const ready = !!data && !!total && !loading && !isError;

  // Scroll results into view when a count is picked (or on return from detail page).
  useEffect(() => {
    if (drillKey && ready) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [drillKey, ready]);

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
          <DateRangeFilter from={filter.from} to={filter.to} latest={latest} scope={state.scope} onChange={onRange} />
          <ScopeFilters state={state} />
          <Box sx={{ flex: 1 }} />
          {can('export_csv') && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DownloadIcon />}
              onClick={() => setExportOpen(true)}
              disabled={!data || !total}
            >
              Export CSV
            </Button>
          )}
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
                  onClick={() => drill.open({ changed: k })}
                  active={sameDrill(active, { changed: k })}
                />
              ))}
              <Tile
                label={mode === 'edit' ? 'Any change' : 'All fields'}
                n={data.changed.any}
                total={total}
                sources={{ dashboard: data.bySource.dashboard.any, sdk: data.bySource.sdk.any }}
                mode={mode}
                strong
                onClick={() => drill.open({ changed: 'any' })}
                active={sameDrill(active, { changed: 'any' })}
              />
            </Box>

            {where === 'kpi' && active && <DrillSection drill={active} state={state} onClose={closeDrill} sectionRef={sectionRef} />}

            <Section
              title="By annotator"
              hint={
                mode === 'edit'
                  ? '% of images each person handled where they changed that field'
                  : '% of images each person handled where they did not change that field'
              }
              footer={<TablePager count={people.length} page={peoplePage} onPage={setPeoplePage} />}
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
                    slice(people, peoplePage).map((a) => (
                      <TableRow key={a.name} hover>
                        <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {a.name}
                        </TableCell>
                        <TableCell align="right">{a.images}</TableCell>
                        <CountCells c={a.changed} total={a.images} drill={drill} scope={{ editor: a.name }} mode={mode} />
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Section>

            {where === 'annotator' && active && <DrillSection drill={active} state={state} onClose={closeDrill} sectionRef={sectionRef} />}

            {data.byDay.length > 1 && (
              <Section title="By capture day" hint={
                  mode === 'edit'
                    ? "% of that day's images with the field edited"
                    : "% of that day's images where the OCR value was not edited"
                }
                footer={<TablePager count={days.length} page={dayPage} onPage={setDayPage} />}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Capture day</TableCell>
                      <TableCell align="right">Total images</TableCell>
                      <HeadCols mode={mode} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {slice(days, dayPage).map((d) => (
                      <TableRow key={d.date} hover>
                        <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {formatDate(d.date)}
                        </TableCell>
                        <TableCell align="right">{d.total}</TableCell>
                        <CountCells c={d.changed} total={d.total} drill={drill} scope={{ day: d.date }} mode={mode} />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )}

            {where === 'day' && active && <DrillSection drill={active} state={state} onClose={closeDrill} sectionRef={sectionRef} />}

            <StatsTrendChart mode={mode} pageFilter={sf} />

          </>
        )
      )}

      <ExportStatsDialog open={exportOpen} onClose={() => setExportOpen(false)} filter={sf} stats={data} />
    </Box>
  );
}
