import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import TextIcon from '@mui/icons-material/ArticleOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import { useAccess } from '../auth/useAccess';
import DateRangeFilter from '../components/DateRangeFilter';
import { ScopeFilters } from '../components/ListToolbar';
import PageBreadcrumbs from '../components/PageBreadcrumbs';
import { carryParams, useListState } from '../hooks/useListState';
import type { AccCounts, AccField, AccResult, AccSource, AccuracyReport, StatsFilter } from '../types';
import { colors } from '../theme';
import { clientLabel, NO_CLIENT } from '../utils/clients';
import { rangeLabel } from '../utils/format';
import { downloadCsv, toCsv, toIST, type Cell } from '../utils/editStats';

/** Same layout + numbers as the Flask GT tool /accuracy; "Engine" → "Model". */
const FIELDS: AccField[] = ['mrp', 'mfgDate', 'expiryDate', 'batchNumber'];
const ROWS: (AccField | 'ALL')[] = [...FIELDS, 'ALL'];
const LABEL: Record<AccField | 'ALL', string> = { mrp: 'MRP', mfgDate: 'MFD', expiryDate: 'Expiry', batchNumber: 'Batch', ALL: 'All fields' };
const SOURCES: AccSource[] = ['model', 'grn'];
const SRC_LABEL: Record<AccSource, string> = { model: 'Model', grn: 'Operator (GRN)' };
const ERR_PAGE = 15;

const BLUE = '#1d4ed8';
const AMBER = '#b45309';
const RESULT_SX: Record<AccResult, object> = {
  right: { color: 'success.dark' },
  wrong: { color: 'error.dark', fontWeight: 600 },
  nv_answered: { color: 'error.dark', fontWeight: 600 },
  held: { color: colors.muted },
  nv_abstain: { color: colors.muted },
};

const pc = (v: number | null) => (v == null ? '–' : `${v}%`);
/** ISO day → DD/MM/YYYY (as the pack prints it). Other values as is. */
const show = (v: string | null | undefined) => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};
const groupTitle = (k: string) =>
  k === 'ALL'
    ? 'All fields'
    : k === 'EDITED'
      ? 'Only fields the operator changed in GRN'
      : k === 'NOT_EDITED'
        ? 'Fields the operator did not change'
        : `Client ${clientLabel(k.slice(7) || NO_CLIENT)}`;

const numSx = { textAlign: 'right', whiteSpace: 'nowrap' } as const;
const allRowSx = { '& td': { fontWeight: 700, borderTop: `2px solid ${colors.textDark}` } };

function Box2({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Paper sx={{ overflow: 'hidden', mt: 2 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
        <Typography variant="h5">{title}</Typography>
        {hint && <Typography sx={{ fontSize: 12.5, color: colors.muted }}>{hint}</Typography>}
      </Box>
      {children}
    </Paper>
  );
}

function Kpi({ name, c }: { name: string; c: AccCounts }) {
  return (
    <Paper sx={{ p: 2, flex: '1 1 200px', minWidth: 0, border: `1px solid ${colors.border}`, boxShadow: 'none' }}>
      <Typography sx={{ fontWeight: 700, color: colors.muted, fontSize: 13 }}>{name} · accuracy</Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 700, color: colors.textDark, lineHeight: 1.2, mt: 0.5 }}>{pc(c.accuracy)}</Typography>
      <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
        {c.right} / {c.answered} answered · {c.held} held (NA)
      </Typography>
    </Paper>
  );
}

function WinnerTable({ rep }: { rep: AccuracyReport }) {
  return (
    <Box2 title="Winner — who matched the approved value" hint="Fields where the approved value has a value. A source with no value counts as not right here.">
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Field</TableCell>
              <TableCell sx={numSx}>Both right</TableCell>
              <TableCell sx={numSx}>Only Model</TableCell>
              <TableCell sx={numSx}>Only operator</TableCell>
              <TableCell sx={numSx}>Neither</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ROWS.map((fl) => {
              const w = rep.wins[fl];
              if (!w) return null;
              return (
                <TableRow key={fl} sx={fl === 'ALL' ? allRowSx : undefined}>
                  <TableCell>{LABEL[fl]}</TableCell>
                  <TableCell sx={numSx}>{w.both}</TableCell>
                  <TableCell sx={{ ...numSx, color: BLUE }}>{w.model}</TableCell>
                  <TableCell sx={{ ...numSx, color: AMBER }}>{w.grn}</TableCell>
                  <TableCell sx={{ ...numSx, color: 'error.dark' }}>{w.neither}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box2>
  );
}

function GroupBox({ title, g }: { title: string; g: AccuracyReport['groups'][string] }) {
  const all = g.ALL;
  return (
    <Box2 title={title}>
      {all && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, p: 2, pb: 0 }}>
          {SOURCES.map((s) => (
            <Kpi key={s} name={SRC_LABEL[s]} c={all[s]} />
          ))}
        </Box>
      )}
      <TableContainer sx={{ overflowX: 'auto', mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Field</TableCell>
              <TableCell>Source</TableCell>
              <TableCell sx={numSx}>With truth</TableCell>
              <TableCell sx={numSx}>Right</TableCell>
              <TableCell sx={numSx}>Wrong</TableCell>
              <TableCell sx={numSx}>Held (NA)</TableCell>
              <TableCell sx={numSx}>Accuracy</TableCell>
              <TableCell sx={numSx}>Coverage</TableCell>
              <TableCell sx={numSx}>Not-visible: answered / abstained</TableCell>
              <TableCell>Near misses</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ROWS.flatMap((fl) =>
              SOURCES.map((s, i) => {
                const c = g[fl]?.[s];
                if (!c) return null;
                return (
                  <TableRow key={`${fl}-${s}`} sx={fl === 'ALL' && i === 0 ? allRowSx : undefined}>
                    <TableCell>{i === 0 ? LABEL[fl] : ''}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{SRC_LABEL[s]}</TableCell>
                    <TableCell sx={numSx}>{c.n}</TableCell>
                    <TableCell sx={numSx}>{c.right}</TableCell>
                    <TableCell sx={numSx}>{c.wrong}</TableCell>
                    <TableCell sx={{ ...numSx, color: colors.muted }}>{c.held}</TableCell>
                    <TableCell sx={{ ...numSx, fontWeight: 700 }}>{pc(c.accuracy)}</TableCell>
                    <TableCell sx={numSx}>{pc(c.coverage)}</TableCell>
                    <TableCell sx={numSx}>
                      {c.nv_answered} / {c.nv_abstain}
                    </TableCell>
                    <TableCell sx={{ color: colors.muted, whiteSpace: 'nowrap' }}>
                      {[c.day_conv ? `${c.day_conv} 1st-vs-last day` : '', c.punct ? `${c.punct} punctuation` : ''].filter(Boolean).join(' ')}
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box2>
  );
}

function ErrorsTable({ rep, onOpen }: { rep: AccuracyReport; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const list = rep.mismatches;
  const last = Math.max(0, Math.ceil(list.length / ERR_PAGE) - 1);
  const p = Math.min(page, last);
  return (
    <Box2 title={`Errors (${list.length})`} hint="Fields where at least one source was wrong. Click a row to open the capture.">
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>No.</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>EAN</TableCell>
              <TableCell>Field</TableCell>
              <TableCell>Approved value</TableCell>
              {SOURCES.map((s) => (
                <TableCell key={s}>{SRC_LABEL[s]}</TableCell>
              ))}
              <TableCell>Approved by</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.slice(p * ERR_PAGE, (p + 1) * ERR_PAGE).map((m, i) => (
              <TableRow
                key={`${m.id}-${m.field}`}
                hover
                tabIndex={0}
                role="link"
                aria-label={`Open capture ${p * ERR_PAGE + i + 1}, ${LABEL[m.field]}`}
                onClick={() => onOpen(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(m.id);
                  }
                }}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell sx={{ color: colors.muted, fontWeight: 600 }}>{p * ERR_PAGE + i + 1}</TableCell>
                <TableCell>{clientLabel(m.client || NO_CLIENT)}</TableCell>
                <TableCell>{m.ean || '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {LABEL[m.field]}
                  {m.edited && <Box component="span" sx={{ color: colors.muted }}> (edited)</Box>}
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{m.truth == null ? '(not visible)' : show(m.truth)}</TableCell>
                {SOURCES.map((s) => (
                  <TableCell key={s} sx={RESULT_SX[m.vals[s][1]]}>
                    {show(m.vals[s][0]) || '—'}
                  </TableCell>
                ))}
                <TableCell sx={{ color: colors.muted }}>{m.by ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {list.length > ERR_PAGE && (
        <TablePagination
          component="div"
          count={list.length}
          page={p}
          rowsPerPage={ERR_PAGE}
          rowsPerPageOptions={[]}
          onPageChange={(_, n) => setPage(n)}
          sx={{ borderTop: `1px solid ${colors.border}` }}
        />
      )}
    </Box2>
  );
}

/** Plain-text report (same lines as the Flask tool's /accuracy.txt). */
function reportText(rep: AccuracyReport, when: string) {
  const pad = (v: Cell, n: number, right = true) => (right ? String(v ?? '').padStart(n) : String(v ?? '').padEnd(n));
  const L = [
    `QCR captures ${when} - Model and GRN accuracy vs approved values (${rep.approved} of ${rep.total} GRN-edited captures approved)`,
    'accuracy = right / (right + wrong); empty value = held = NA, not counted | coverage = answered / with truth',
  ];
  for (const gk of rep.order) {
    L.push('', `=== ${groupTitle(gk)}`);
    L.push(`${pad('field', 10, false)}| ${pad('source', 15, false)}| ${pad('n', 5)} ${pad('right', 6)} ${pad('wrong', 6)} ${pad('held', 5)} | ${pad('accuracy', 8)} ${pad('coverage', 8)} | notes`);
    for (const fl of ROWS) {
      for (const s of SOURCES) {
        const c = rep.groups[gk]?.[fl]?.[s];
        if (!c) continue;
        const notes = [
          c.nv_answered ? `${c.nv_answered} answered where truth not visible` : '',
          c.day_conv ? `${c.day_conv} wrong only by 1st-vs-last day` : '',
          c.punct ? `${c.punct} wrong only by punctuation` : '',
        ].filter(Boolean);
        L.push(
          `${pad(LABEL[fl], 10, false)}| ${pad(SRC_LABEL[s], 15, false)}| ${pad(c.n, 5)} ${pad(c.right, 6)} ${pad(c.wrong, 6)} ${pad(c.held, 5)} | ${pad(pc(c.accuracy), 8)} ${pad(pc(c.coverage), 8)} | ${notes.join('; ')}`,
        );
      }
    }
  }
  if (Object.keys(rep.wins).length) {
    L.push('', '=== Winner (fields with a value): field | both right | only model | only operator | neither');
    for (const fl of ROWS) {
      const w = rep.wins[fl];
      if (w) L.push(`${pad(LABEL[fl], 10, false)}| ${pad(w.both, 5)} | ${pad(w.model, 5)} | ${pad(w.grn, 5)} | ${pad(w.neither, 5)}`);
    }
  }
  return L.join('\n');
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** CSV: one row per approved capture — approved values, winner, per-field right/wrong for each source. */
function accuracyCsv(rep: AccuracyReport) {
  const head: Cell[] = [
    'Capture',
    'Client',
    'EAN',
    ...FIELDS.map((f) => `Approved ${LABEL[f]}`),
    ...FIELDS.map((f) => `Model ${LABEL[f]}`),
    ...FIELDS.map((f) => `GRN ${LABEL[f]}`),
    ...FIELDS.map((f) => `GRN changed ${LABEL[f]}`),
    ...FIELDS.map((f) => `Winner ${LABEL[f]}`),
    ...FIELDS.flatMap((f) => SOURCES.map((s) => `${LABEL[f]} ${s === 'model' ? 'Model' : 'GRN'} vs approved`)),
    'Approved by',
    'Approved at (IST)',
  ];
  const lines: Cell[][] = [head];
  rep.rows.forEach((r, i) => {
    lines.push([
      i + 1,
      clientLabel(r.client || NO_CLIENT),
      r.ean,
      ...FIELDS.map((f) => (r.fields[f].truth ? show(r.fields[f].truth) : 'NOT_VISIBLE')),
      ...FIELDS.map((f) => show(r.fields[f].vals.model[0])),
      ...FIELDS.map((f) => show(r.fields[f].vals.grn[0])),
      ...FIELDS.map((f) => (r.fields[f].edited ? 'yes' : '')),
      ...FIELDS.map((f) => (r.fields[f].winner === 'na' ? 'NA (not visible)' : r.fields[f].winner)),
      ...FIELDS.flatMap((f) => SOURCES.map((s) => r.fields[f][s])),
      r.by ?? '',
      toIST(r.at),
    ]);
  });
  return toCsv(lines);
}

/** Model and GRN vs approved values (ground truth). Approved captures only, capture day (IST). */
export default function AccuracyPage() {
  const state = useListState();
  const navigate = useNavigate();
  const { can } = useAccess();
  const { params, filter, latest, needDefaultDate, setRange } = state;
  const sf: StatsFilter = { from: filter.from, to: filter.to, client: filter.client };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['accuracy', sf],
    queryFn: () => api.getAccuracy(sf),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });
  const loading = isLoading || needDefaultDate;
  const when = rangeLabel(filter.from, filter.to);
  const tag = filter.from ? (filter.to && filter.to !== filter.from ? `${filter.from}_${filter.to}` : filter.from) : 'all';

  // Detail page: prev/next walks approved captures in this range; Back returns here.
  const open = (id: string) => {
    const qs = carryParams(params, ['q', 'status', 'changed', 'editor', 'day', 'grnEdited'], { approved: '1', src: 'accuracy' });
    navigate(`/documents/${encodeURIComponent(id)}?${qs}`);
  };
  // Client groups only help when more than one client is in the report.
  const order = data ? data.order.filter((k) => !k.startsWith('client:') || data.order.filter((x) => x.startsWith('client:')).length > 1) : [];

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={[{ label: 'Accuracy' }]} />

      <Paper sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <DateRangeFilter from={filter.from} to={filter.to} latest={latest} scope={state.scope} onChange={(a, b) => setRange(a, b)} />
          <ScopeFilters state={state} />
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<TextIcon />}
            disabled={!data?.approved}
            onClick={() => data && downloadText(`accuracy_${tag}.txt`, reportText(data, when))}
          >
            Plain-text report
          </Button>
          {can('export_csv') && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DownloadIcon />}
              disabled={!data?.approved}
              onClick={() => data && downloadCsv(`accuracy_${tag}.csv`, accuracyCsv(data))}
            >
              CSV with per-field right/wrong
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
          {(error as Error)?.message || 'Could not load accuracy.'}
        </Alert>
      ) : loading || !data ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={160} sx={{ flex: '1 1 100%' }} />
          ))}
        </Box>
      ) : (
        <>
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              Model and GRN compared to approved values
            </Typography>
            <Typography sx={{ fontSize: 13, color: colors.muted, mt: 0.5, maxWidth: 980 }}>
              {data.approved} of {data.total} GRN-edited captures approved · captured {when}
              {data.approved < data.total ? ' — partial results, will change as approval continues' : ''}.{' '}
              <b>Accuracy</b> = right ÷ (right + wrong). <b>Held</b> = the source has no value; it is treated as NA and left out of
              accuracy. <b>Coverage</b> = answered ÷ fields with truth. <b>Not visible</b> = approved value is blank (not on the photo).
            </Typography>
          </Box>

          {!data.approved ? (
            <Paper sx={{ mt: 2, py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
              <InboxIcon sx={{ fontSize: 48, color: colors.subtle }} />
              <Typography variant="h5" sx={{ mt: 1 }}>
                No approved GRN-edited captures in this range
              </Typography>
              <Typography>Approve captures on the capture page, or pick another date or client.</Typography>
            </Paper>
          ) : (
            <>
              <WinnerTable rep={data} />
              {order.map((gk) => (
                <GroupBox key={gk} title={groupTitle(gk)} g={data.groups[gk]} />
              ))}
              {data.mismatches.length > 0 && <ErrorsTable key={JSON.stringify(sf)} rep={data} onOpen={open} />}
            </>
          )}
        </>
      )}
    </Box>
  );
}
