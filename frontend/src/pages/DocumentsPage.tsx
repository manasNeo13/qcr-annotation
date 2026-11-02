import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import DateRangeFilter from '../components/DateRangeFilter';
import { rangeLabel } from '../utils/format';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
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
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Close';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import StatusChip from '../components/StatusChip';
import type { DocumentItem, StatusFilter } from '../types';
import { formatDate, formatDateTime, formatMRP } from '../utils/format';
import { FILTERS } from '../utils/status';
import { colors } from '../theme';

/** Fixed page size. */
const PAGE_SIZE = 15;
const isStatus = (v: string | null): v is StatusFilter => FILTERS.some((f) => f.value === v);

export default function DocumentsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = PAGE_SIZE;
  const statusParam = params.get('status');
  const status: StatusFilter = isStatus(statusParam) ? statusParam : 'all';
  const q = params.get('q') ?? '';
  // Date range (IST capture day). No params → default to latest day with data; all=1 → every date.
  const allDates = params.get('all') === '1';
  const from = allDates ? undefined : (params.get('from') ?? undefined);
  const to = from ? (params.get('to') ?? from) : undefined;
  const needDefaultDate = !allDates && !from;

  const [search, setSearch] = useState(q);

  const update = (patch: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      const defaults: Record<string, string> = { page: '1', status: 'all', q: '' };
      if (v == null || v === '' || String(v) === defaults[k]) next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const setRange = (a?: string, b?: string) =>
    update(
      a ? { from: a, to: b && b !== a ? b : null, all: null, page: 1 } : { from: null, to: null, all: '1', page: 1 },
    );

  const today = dayjs().format('YYYY-MM-DD');
  const { data: latestInfo } = useQuery({
    queryKey: ['latest-day'],
    queryFn: () => api.getDays(today, today),
    staleTime: 60_000,
  });
  const latest = latestInfo?.latest ?? null;

  useEffect(() => {
    if (needDefaultDate && latestInfo) setRange(latest ?? undefined, latest ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needDefaultDate, latestInfo]);

  // Debounced search → URL
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim(), page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['documents', { page, pageSize, q, status, from, to }],
    queryFn: () => api.listDocuments({ page, pageSize, q, status, from, to }),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });

  // Carry list filter so detail page can do prev/next + return to same list.
  const open = (id: string) => navigate(`/documents/${encodeURIComponent(id)}?${params.toString()}`);
  const onRowKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(id);
    }
  };

  const items = data?.items ?? [];

  return (
    <Box className="nq-fade-up">
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '1.35rem', sm: '1.5rem' } }}>
          Documents
        </Typography>
        <Typography sx={{ color: 'text.secondary' }}>
          {data ? `${data.counts.all.toLocaleString()} capture${data.counts.all === 1 ? '' : 's'}` : 'Loading…'} ·{' '}
          {rangeLabel(from, to)} · Click a row to review and edit metadata.
        </Typography>
      </Box>

      <Paper sx={{ overflow: 'hidden' }}>
        {/* Toolbar */}
        <Box
          sx={{
            p: { xs: 1.5, sm: 2 },
            display: 'flex',
            flexDirection: { xs: 'column', lg: 'row' },
            alignItems: { xs: 'stretch', lg: 'center' },
            gap: 1.5,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
              gap: 1,
              flex: 1,
              maxWidth: { lg: 640 },
              minWidth: 0,
            }}
          >
            <DateRangeFilter from={from} to={to} latest={latest} onChange={setRange} />
            <TextField
              size="small"
              placeholder="Search EAN, batch no., capture ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, minWidth: { xs: 200, sm: 0 } }}
              slotProps={{
                htmlInput: { 'aria-label': 'Search documents' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: search ? (
                    <InputAdornment position="end">
                      <IconButton size="small" aria-label="Clear search" onClick={() => setSearch('')}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
          </Box>
          <Box sx={{ flex: 1, display: { xs: 'none', lg: 'block' } }} />
          <Box className="scrollbar-hide" sx={{ overflowX: 'auto', mx: { xs: -1.5, sm: 0 }, px: { xs: 1.5, sm: 0 } }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={status}
              onChange={(_, v: StatusFilter | null) => v && update({ status: v, page: 1 })}
              aria-label="Filter by status"
              sx={{ flexWrap: 'nowrap' }}
            >
              {FILTERS.map((f) => (
                <ToggleButton key={f.value} value={f.value} sx={{ px: { xs: 1.25, sm: 1.75 } }}>
                  {f.label}
                  <Box
                    component="span"
                    sx={{
                      fontSize: 11,
                      fontWeight: 700,
                      px: 0.75,
                      borderRadius: '5px',
                      bgcolor: status === f.value ? '#fff' : colors.background,
                      minWidth: 22,
                      textAlign: 'center',
                    }}
                  >
                    {data?.counts[f.value] ?? '–'}
                  </Box>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        </Box>

        <Box sx={{ height: 3 }}>{isFetching && !isLoading && <LinearProgress sx={{ height: 3 }} />}</Box>

        {isError ? (
          <Box sx={{ p: 3 }}>
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error)?.message || 'Could not load documents.'}
            </Alert>
          </Box>
        ) : !isLoading && items.length === 0 ? (
          <Box sx={{ py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
            <InboxIcon sx={{ fontSize: 48, color: colors.subtle }} />
            <Typography variant="h5" sx={{ mt: 1 }}>
              No documents found
            </Typography>
            <Typography>Try another date range, search or status filter.</Typography>
            {!allDates && (
              <Button variant="outlined" color="secondary" sx={{ mt: 2, mr: 1 }} onClick={() => setRange()}>
                Show all dates
              </Button>
            )}
            {(q || status !== 'all') && (
              <Button
                variant="outlined"
                color="secondary"
                sx={{ mt: 2 }}
                onClick={() => {
                  setSearch('');
                  update({ q: null, status: null, page: null });
                }}
              >
                Clear filters
              </Button>
            )}
          </Box>
        ) : isMobile ? (
          /* Mobile / tablet: card list */
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {(isLoading ? Array.from({ length: 6 }) : items).map((d, i) => {
              const doc = d as DocumentItem | undefined;
              return (
                <Box
                  component="li"
                  key={doc?.id ?? i}
                  role={doc ? 'button' : undefined}
                  tabIndex={doc ? 0 : -1}
                  onClick={doc ? () => open(doc.id) : undefined}
                  onKeyDown={doc ? (e) => onRowKey(e, doc.id) : undefined}
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    p: 1.5,
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: doc ? 'pointer' : 'default',
                    transition: 'background .2s',
                    '&:hover': { bgcolor: colors.surface2 },
                  }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    {doc ? (
                      <>
                        <Box
                          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, justifyContent: 'space-between' }}
                        >
                          <Typography sx={{ fontWeight: 600, color: colors.textDark, lineHeight: 1.3 }} noWrap>
                            {doc.productName}
                          </Typography>
                          <StatusChip status={doc.status} />
                        </Box>
                        <Typography sx={{ fontSize: 12, color: colors.muted }} noWrap>
                          Batch {doc.metadata.batchNumber}
                        </Typography>
                        <Box
                          sx={{
                            mt: 0.5,
                            display: 'flex',
                            flexWrap: 'wrap',
                            columnGap: 1.5,
                            fontSize: 12.5,
                            color: colors.textPrimary,
                          }}
                        >
                          <span>MFG {formatDate(doc.metadata.mfgDate)}</span>
                          <span>EXP {formatDate(doc.metadata.expiryDate)}</span>
                          <b>{formatMRP(doc.metadata.mrp)}</b>
                        </Box>
                      </>
                    ) : (
                      <>
                        <Skeleton width="70%" />
                        <Skeleton width="50%" />
                        <Skeleton width="80%" />
                      </>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : (
          /* Desktop: table */
          <TableContainer>
            <Table sx={{ minWidth: 860 }} aria-label="Documents">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 3 }}>Document</TableCell>
                  <TableCell>Batch no.</TableCell>
                  <TableCell>MFG date</TableCell>
                  <TableCell>Expiry date</TableCell>
                  <TableCell align="right">MRP</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={{ display: { md: 'none', lg: 'table-cell' } }}>Last updated</TableCell>
                  <TableCell width={48} />
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ pl: 3 }}>
                          <Skeleton width={180} />
                        </TableCell>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <TableCell key={j} sx={j === 5 ? { display: { md: 'none', lg: 'table-cell' } } : undefined}>
                            <Skeleton />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : items.map((doc) => (
                      <TableRow
                        key={doc.id}
                        hover
                        tabIndex={0}
                        role="link"
                        aria-label={`Open ${doc.productName}, batch ${doc.metadata.batchNumber}`}
                        onClick={() => open(doc.id)}
                        onKeyDown={(e) => onRowKey(e, doc.id)}
                        sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                      >
                        <TableCell sx={{ pl: 3, fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                          {doc.productName}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                          {doc.metadata.batchNumber}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(doc.metadata.mfgDate)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(doc.metadata.expiryDate)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {formatMRP(doc.metadata.mrp)}
                        </TableCell>
                        <TableCell>
                          <StatusChip status={doc.status} />
                        </TableCell>
                        <TableCell
                          sx={{
                            display: { md: 'none', lg: 'table-cell' },
                            color: colors.muted,
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDateTime(doc.updatedAt)}
                          {doc.version > 1 && (
                            <Box component="span" sx={{ display: 'block', fontSize: 11, color: colors.brandDark }}>
                              Edited · v{doc.version}
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <ChevronRightIcon sx={{ color: colors.subtle }} />
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {!isError && (data?.total ?? 0) > 0 && (
          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={page - 1}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[]}
            onPageChange={(_, p) => {
              update({ page: p + 1 });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            sx={{
              borderTop: `1px solid ${colors.border}`,
              '.MuiTablePagination-toolbar': { px: { xs: 1, sm: 2 }, flexWrap: 'wrap', justifyContent: 'flex-end' },
              '.MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } },
            }}
          />
        )}
      </Paper>
    </Box>
  );
}
