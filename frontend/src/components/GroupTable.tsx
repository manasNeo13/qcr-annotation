import type { ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import type { DocStatus, GroupItem, GroupResponse } from '../types';
import { NONE_KEY } from '../types';
import { formatDateTime } from '../utils/format';
import { STATUS_META } from '../utils/status';
import { colors } from '../theme';
import { Pager } from './DocumentTable';

interface Props {
  by: 'ean' | 'batch';
  data?: GroupResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onOpen: (key: string) => void;
  label: (key: string) => string;
  emptyActions?: ReactNode;
}

const STATUSES: DocStatus[] = ['ok', 'near_expiry', 'expired'];

/** Small coloured counts: OK / Near expiry / Expired (zeros hidden). */
function StatusCounts({ counts }: { counts: GroupItem['counts'] }) {
  const shown = STATUSES.filter((s) => counts[s] > 0);
  if (!shown.length) return <>—</>;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {shown.map((s) => (
        <Box
          key={s}
          component="span"
          title={STATUS_META[s].label}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 0.75,
            borderRadius: '4px',
            bgcolor: STATUS_META[s].bg,
            color: STATUS_META[s].fg,
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.7,
            whiteSpace: 'nowrap',
          }}
        >
          <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STATUS_META[s].dot }} />
          {STATUS_META[s].label} {counts[s].toLocaleString()}
        </Box>
      ))}
    </Box>
  );
}

/** EAN or batch group list. Click row → drill down. */
export default function GroupTable({
  by,
  data,
  isLoading,
  isFetching,
  isError,
  error,
  refetch,
  page,
  pageSize,
  onPage,
  onOpen,
  label,
  emptyActions,
}: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const items = data?.items ?? [];
  const title = by === 'ean' ? 'EAN' : 'Batch no.';
  const onKey = (e: React.KeyboardEvent, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(key);
    }
  };
  const keySx = (key: string) => ({
    fontFamily: key === NONE_KEY ? undefined : 'ui-monospace, monospace',
    fontStyle: key === NONE_KEY ? 'italic' : undefined,
    fontWeight: 600,
    color: key === NONE_KEY ? colors.muted : colors.textDark,
  });

  return (
    <>
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
            {(error as Error)?.message || 'Could not load list.'}
          </Alert>
        </Box>
      ) : !isLoading && items.length === 0 ? (
        <Box sx={{ py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
          <InboxIcon sx={{ fontSize: 48, color: colors.subtle }} />
          <Typography variant="h5" sx={{ mt: 1 }}>
            {by === 'ean' ? 'No EANs found' : 'No batches found'}
          </Typography>
          <Typography>Try another date range, search or filter.</Typography>
          {emptyActions}
        </Box>
      ) : isMobile ? (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {(isLoading ? Array.from({ length: 6 }) : items).map((x, i) => {
            const g = x as GroupItem | undefined;
            return (
              <Box
                component="li"
                key={g?.key ?? i}
                role={g ? 'button' : undefined}
                tabIndex={g ? 0 : -1}
                onClick={g ? () => onOpen(g.key) : undefined}
                onKeyDown={g ? (e) => onKey(e, g.key) : undefined}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1.5,
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: g ? 'pointer' : 'default',
                  '&:hover': { bgcolor: colors.surface2 },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {g ? (
                    <>
                      <Typography noWrap sx={keySx(g.key)}>
                        {label(g.key)}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: colors.muted, mb: 0.5 }}>
                        {g.total.toLocaleString()} capture{g.total === 1 ? '' : 's'}
                        {g.batches != null && ` · ${g.batches.toLocaleString()} batch${g.batches === 1 ? '' : 'es'}`}
                      </Typography>
                      <StatusCounts counts={g.counts} />
                    </>
                  ) : (
                    <>
                      <Skeleton width="60%" />
                      <Skeleton width="40%" />
                    </>
                  )}
                </Box>
                {g && <ChevronRightIcon sx={{ color: colors.subtle }} />}
              </Box>
            );
          })}
        </Box>
      ) : (
        <TableContainer>
          <Table sx={{ minWidth: 760 }} aria-label={by === 'ean' ? 'EANs' : 'Batches'}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 3 }}>{title}</TableCell>
                {by === 'ean' && <TableCell align="right">Batches</TableCell>}
                <TableCell align="right">Captures</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last capture</TableCell>
                <TableCell width={48} />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: by === 'ean' ? 6 : 5 }).map((__, j) => (
                        <TableCell key={j} sx={j === 0 ? { pl: 3 } : undefined}>
                          <Skeleton />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((g) => (
                    <TableRow
                      key={g.key}
                      hover
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${title} ${label(g.key)}`}
                      onClick={() => onOpen(g.key)}
                      onKeyDown={(e) => onKey(e, g.key)}
                      sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                    >
                      <TableCell sx={{ pl: 3, fontSize: 14, whiteSpace: 'nowrap', ...keySx(g.key) }}>
                        {label(g.key)}
                      </TableCell>
                      {by === 'ean' && <TableCell align="right">{g.batches?.toLocaleString() ?? '—'}</TableCell>}
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {g.total.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StatusCounts counts={g.counts} />
                      </TableCell>
                      <TableCell sx={{ color: colors.muted, fontSize: 13, whiteSpace: 'nowrap' }}>
                        {formatDateTime(g.latest ?? undefined)}
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
        <Pager count={data?.total ?? 0} page={page} pageSize={pageSize} onPage={onPage} />
      )}
    </>
  );
}
