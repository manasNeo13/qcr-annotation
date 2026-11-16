import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import type { AuditEntry } from '../../types';
import { formatDateTime } from '../../utils/format';
import { PERMISSION_INFO, type Permission } from '../../utils/permissions';
import { Pager } from './common';
import { ADMIN_KEYS, ADMIN_PAGE_SIZE } from './keys';

const ACTION: Record<AuditEntry['action'], string> = {
  'user.create': 'Added user',
  'user.update': 'Edited user',
  'role.create': 'Created role',
  'role.update': 'Changed permissions',
  'role.delete': 'Deleted role',
};

const FIELD: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  role: 'Role',
  active: 'Status',
  stores: 'Stores',
  permissions: 'Permissions',
  users: 'Users moved to No role',
};

const show = (field: string, v: unknown): string => {
  if (v == null || v === '') return field === 'role' ? 'No role' : '—';
  if (field === 'active') return v ? 'Active' : 'Inactive';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'None';
  return String(v);
};

/** One change line. Permissions → +added / −removed labels. */
function Change({ field, from, to }: { field: string; from: unknown; to: unknown }) {
  if (field === 'permissions') {
    const a = (Array.isArray(from) ? from : []) as Permission[];
    const b = (Array.isArray(to) ? to : []) as Permission[];
    const added = b.filter((p) => !a.includes(p));
    const removed = a.filter((p) => !b.includes(p));
    return (
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {added.map((p) => (
          <Chip key={p} size="small" label={`+ ${PERMISSION_INFO[p]?.label ?? p}`} sx={{ bgcolor: colors.brandSoft, color: colors.brandDark }} />
        ))}
        {removed.map((p) => (
          <Chip key={p} size="small" label={`− ${PERMISSION_INFO[p]?.label ?? p}`} sx={{ bgcolor: '#fef2f2', color: '#a20e00' }} />
        ))}
        {!added.length && !removed.length && <Typography sx={{ fontSize: 13, color: colors.muted }}>No change</Typography>}
      </Box>
    );
  }
  if (field === 'users') return <Typography sx={{ fontSize: 13 }}>{FIELD.users}: {String(from)}</Typography>;
  return (
    <Typography sx={{ fontSize: 13, lineHeight: 1.5 }}>
      <Box component="span" sx={{ color: colors.muted }}>{FIELD[field] ?? field}: </Box>
      {from !== null && (
        <>
          <Box component="span" sx={{ textDecoration: 'line-through', color: colors.subtle }}>{show(field, from)}</Box>
          {' → '}
        </>
      )}
      <Box component="span" sx={{ fontWeight: 600, color: colors.textDark }}>{show(field, to)}</Box>
    </Typography>
  );
}

/** Who changed what in users / roles, newest first. */
export default function AuditTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...ADMIN_KEYS.audit, page],
    queryFn: () => adminApi.audit(page, ADMIN_PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  if (isError) {
    return (
      <Alert
        severity="error"
        sx={{ m: 2 }}
        action={
          <Button color="inherit" size="small" onClick={() => refetch()}>
            Retry
          </Button>
        }
      >
        {(error as Error)?.message || 'Could not load change log.'}
      </Alert>
    );
  }

  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>By</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Target</TableCell>
              <TableCell>Changes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton height={32} />
                  </TableCell>
                </TableRow>
              ))
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 6, textAlign: 'center', color: colors.muted }}>
                  No changes yet. User and role edits will show here.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((e) => (
                <TableRow key={e.id} sx={{ verticalAlign: 'top' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at ?? undefined)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: colors.textDark }}>{e.by?.name || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{ACTION[e.action] ?? e.action}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{e.target?.name || '—'}</Typography>
                    <Typography sx={{ fontSize: 12, color: colors.muted }}>
                      {e.target?.type === 'role' ? 'Role' : `User ${e.target?.id ?? ''}`}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {Object.entries(e.changes).map(([f, c]) => (
                        <Change key={f} field={f} from={c.from} to={c.to} />
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {!!data?.total && <Pager count={data.total} page={page} onPage={setPage} />}
    </>
  );
}
