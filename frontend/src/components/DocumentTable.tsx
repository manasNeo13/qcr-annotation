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
  TablePagination,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import StatusChip from './StatusChip';
import type { DocMetadata, DocumentItem, EditField, ListResponse } from '../types';
import { formatDate, formatDateTime, formatMRP } from '../utils/format';
import { colors } from '../theme';
import { FIELD_LABELS as EDIT_LABEL } from '../utils/editStats';

interface Props {
  data?: ListResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
  /** Buttons shown in empty state. */
  emptyActions?: ReactNode;
  /** Edit drill-down: show original value (struck) above changed values + who edited. */
  showEdits?: boolean;
  /** Don't jump to page top on page change (caller scrolls itself). */
  keepScroll?: boolean;
  /** Capture ids to glow briefly (live: just refreshed). */
  highlight?: Set<string>;
}

const SHOW: Record<EditField, (m: DocMetadata) => string> = {
  batch: (m) => m.batchNumber || '—',
  mfd: (m) => formatDate(m.mfgDate),
  expiry: (m) => formatDate(m.expiryDate),
  mrp: (m) => formatMRP(m.mrp),
};

/** Current value; if edited (and showEdits), original OCR value struck through above it. */
function Val({ doc, field, show }: { doc: DocumentItem; field: EditField; show?: boolean }) {
  const now = SHOW[field](doc.metadata);
  if (!show || !doc.edit?.changed.includes(field)) return <>{now}</>;
  return (
    <>
      <Box component="span" sx={{ display: 'block', fontSize: 11.5, color: colors.muted, textDecoration: 'line-through' }}>
        {SHOW[field](doc.edit.original)}
      </Box>
      <Box component="span" sx={{ color: colors.brandDark, fontWeight: 700 }}>
        {now}
      </Box>
    </>
  );
}

/** Capture list: table on desktop, cards on mobile, with pagination. */
export default function DocumentTable({
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
  emptyActions,
  showEdits,
  keepScroll,
  highlight,
}: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const items = data?.items ?? [];
  // No. 1 = oldest in this list → a capture keeps its number when new ones arrive on top.
  const serial = (i: number) => ((data?.total ?? 0) - ((page - 1) * pageSize + i)).toLocaleString();
  const onRowKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(id);
    }
  };

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
            {(error as Error)?.message || 'Could not load documents.'}
          </Alert>
        </Box>
      ) : !isLoading && items.length === 0 ? (
        <Box sx={{ py: 8, px: 3, textAlign: 'center', color: 'text.secondary' }}>
          <InboxIcon sx={{ fontSize: 48, color: colors.subtle }} />
          <Typography variant="h5" sx={{ mt: 1 }}>
            No documents found
          </Typography>
          <Typography>Try another date range, search or filter.</Typography>
          {emptyActions}
        </Box>
      ) : isMobile ? (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {(isLoading ? Array.from({ length: 6 }) : items).map((d, i) => {
            const doc = d as DocumentItem | undefined;
            return (
              <Box
                component="li"
                key={doc?.id ?? i}
                className={doc && highlight?.has(doc.id) ? 'nq-new-row' : undefined}
                role={doc ? 'button' : undefined}
                tabIndex={doc ? 0 : -1}
                onClick={doc ? () => onOpen(doc.id) : undefined}
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
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, justifyContent: 'space-between' }}>
                        <Typography sx={{ fontWeight: 600, color: colors.textDark, lineHeight: 1.3 }} noWrap>
                          {doc.productName}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
                          {doc.grnEdited && (
                            <Box
                              component="span"
                              sx={{
                                px: 0.75,
                                py: 0.1,
                                borderRadius: '5px',
                                fontSize: 11,
                                fontWeight: 700,
                                bgcolor: '#ecfdf5',
                                color: '#007849',
                                border: '1px solid #a7f3d0',
                                lineHeight: 1.6,
                              }}
                            >
                              GRN ✓
                            </Box>
                          )}
                          <StatusChip status={doc.status} />
                        </Box>
                      </Box>
                      <Typography sx={{ fontSize: 12, color: colors.muted }} noWrap>
                        Batch {doc.metadata.batchNumber || '—'}
                      </Typography>
                      {showEdits && doc.edit && (
                        <Box sx={{ mt: 0.5, fontSize: 12, color: colors.textPrimary }}>
                          {doc.edit.changed.map((f) => (
                            <Box key={f}>
                              <b>{EDIT_LABEL[f]}</b>{' '}
                              <Box component="span" sx={{ textDecoration: 'line-through', color: colors.muted }}>
                                {SHOW[f](doc.edit!.original)}
                              </Box>{' '}
                              → <Box component="span" sx={{ color: colors.brandDark, fontWeight: 700 }}>{SHOW[f](doc.metadata)}</Box>
                            </Box>
                          ))}
                          {doc.edit.editors.length > 0 && (
                            <Box sx={{ color: colors.muted }}>by {doc.edit.editors.join(', ')}</Box>
                          )}
                        </Box>
                      )}
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
        <TableContainer>
          <Table sx={{ minWidth: 860 }} aria-label="Documents">
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 3, width: 72 }}>No.</TableCell>
                <TableCell>Document</TableCell>
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
                      {Array.from({ length: 8 }).map((__, j) => (
                        <TableCell key={j} sx={j === 6 ? { display: { md: 'none', lg: 'table-cell' } } : undefined}>
                          <Skeleton />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((doc, i) => (
                    <TableRow
                      key={doc.id}
                      className={highlight?.has(doc.id) ? 'nq-new-row' : undefined}
                      hover
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${doc.productName}, batch ${doc.metadata.batchNumber}`}
                      onClick={() => onOpen(doc.id)}
                      onKeyDown={(e) => onRowKey(e, doc.id)}
                      sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                    >
                      <TableCell sx={{ pl: 3, color: colors.muted, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {serial(i)}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' }}>
                        {doc.productName}
                        {doc.assignedTo && (
                          <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 500, color: colors.muted }}>
                            Assigned: {doc.assignedTo}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                        <Val doc={doc} field="batch" show={showEdits} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Val doc={doc} field="mfd" show={showEdits} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Val doc={doc} field="expiry" show={showEdits} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <Val doc={doc} field="mrp" show={showEdits} />
                      </TableCell>
                      <TableCell>
                        <StatusChip status={doc.status} />
                        {doc.grnEdited && (
                          <Box
                            component="span"
                            sx={{
                              display: 'inline-block',
                              mt: 0.5,
                              px: 0.75,
                              py: 0.1,
                              borderRadius: '5px',
                              fontSize: 11,
                              fontWeight: 700,
                              bgcolor: '#ecfdf5',
                              color: '#007849',
                              border: '1px solid #a7f3d0',
                              lineHeight: 1.6,
                            }}
                          >
                            GRN ✓
                          </Box>
                        )}
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
                        {showEdits && doc.edit?.editors.length ? (
                          <Box component="span" sx={{ display: 'block', fontSize: 11, color: colors.brandDark }}>
                            by {doc.edit.editors.join(', ')}
                          </Box>
                        ) : (
                          doc.version > 1 && (
                            <Box component="span" sx={{ display: 'block', fontSize: 11, color: colors.brandDark }}>
                              Edited · v{doc.version}
                            </Box>
                          )
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
        <Pager count={data?.total ?? 0} page={page} pageSize={pageSize} onPage={onPage} keepScroll={keepScroll} />
      )}
    </>
  );
}

/** Shared bottom pagination (fixed page size). */
export function Pager({
  count,
  page,
  pageSize,
  onPage,
  keepScroll,
}: {
  count: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  keepScroll?: boolean;
}) {
  return (
    <TablePagination
      component="div"
      count={count}
      page={Math.min(page - 1, Math.max(0, Math.ceil(count / pageSize) - 1))}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[]}
      onPageChange={(_, p) => {
        onPage(p + 1);
        if (!keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      sx={{
        borderTop: `1px solid ${colors.border}`,
        '.MuiTablePagination-toolbar': { px: { xs: 1, sm: 2 }, flexWrap: 'wrap', justifyContent: 'flex-end' },
        '.MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } },
      }}
    />
  );
}
