import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import SearchIcon from '@mui/icons-material/Search';
import { adminApi } from '../../api/admin';
import { useAuth } from '../../auth/AuthContext';
import { colors } from '../../theme';
import type { AdminUser } from '../../types';
import { clientLabel } from '../../utils/clients';
import { ActiveChip, Pager, RoleChip } from './common';
import { ADMIN_KEYS, ADMIN_PAGE_SIZE, roleMap } from './keys';
import UserDrawer from './UserDrawer';

type Status = 'all' | 'active' | 'inactive';
const ALL = '~all';
const NONE = '~none';

export default function UsersTab() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>(ALL);
  const [client, setClient] = useState<string>(ALL);
  const [status, setStatus] = useState<Status>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = {
    q,
    role: role === ALL ? undefined : role,
    client: client === ALL ? undefined : client === NONE ? '' : client,
    status,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  };
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: [...ADMIN_KEYS.users, query],
    queryFn: () => adminApi.listUsers(query),
    placeholderData: keepPreviousData,
  });
  const { data: roleData } = useQuery({ queryKey: ADMIN_KEYS.roles, queryFn: adminApi.roles });
  const { data: clients = [] } = useQuery({ queryKey: ADMIN_KEYS.clients, queryFn: adminApi.clients, staleTime: 5 * 60_000 });
  const roles = roleData?.roles ?? [];
  const byKey = roleMap(roles);

  return (
    <>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search name, ID, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: '1 1 240px', maxWidth: 360 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          size="small"
          label="Role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          sx={{ width: 180 }}
        >
          <MenuItem value={ALL}>All roles</MenuItem>
          {roles.map((r) => (
            <MenuItem key={r.key || '~none'} value={r.key}>
              {r.name} ({r.users})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Client"
          value={client}
          onChange={(e) => {
            setClient(e.target.value);
            setPage(1);
          }}
          sx={{ width: 160 }}
        >
          <MenuItem value={ALL}>All clients</MenuItem>
          {clients.map((c) => (
            <MenuItem key={c} value={c}>
              {clientLabel(c)}
            </MenuItem>
          ))}
          <MenuItem value={NONE}>No client assigned</MenuItem>
        </TextField>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v: Status | null) => {
            if (!v) return;
            setStatus(v);
            setPage(1);
          }}
          aria-label="Status"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="inactive">Inactive</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          Add user
        </Button>
      </Box>
      <Box sx={{ height: 3 }}>{isFetching && !isLoading && <LinearProgress sx={{ height: 3 }} />}</Box>

      {isError ? (
        <Alert
          severity="error"
          sx={{ m: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {(error as Error)?.message || 'Could not load users.'}
        </Alert>
      ) : (
        <>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Clients</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton height={32} />
                        </TableCell>
                      </TableRow>
                    ))
                  : data?.items.length === 0
                    ? (
                      <TableRow>
                        <TableCell colSpan={6} sx={{ py: 6, textAlign: 'center', color: colors.muted }}>
                          No users match.
                        </TableCell>
                      </TableRow>
                    )
                    : data?.items.map((u) => (
                        <TableRow
                          key={u.key}
                          hover
                          tabIndex={0}
                          onClick={() => setEditing(u)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditing(u)}
                          sx={{ cursor: 'pointer', opacity: u.active ? 1 : 0.6 }}
                        >
                          <TableCell>
                            <Typography sx={{ fontWeight: 600, color: colors.textDark, lineHeight: 1.3 }}>
                              {u.name || '—'}
                              {u.key === me?.id && (
                                <Chip size="small" label="You" sx={{ ml: 1, height: 18, fontSize: 11 }} />
                              )}
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: colors.muted }}>{u.id || '—'}</Typography>
                          </TableCell>
                          <TableCell sx={{ wordBreak: 'break-all' }}>{u.email || '—'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{u.phone || '—'}</TableCell>
                          <TableCell>
                            <RoleChip name={u.roleKey ? (byKey.get(u.roleKey)?.name ?? u.role) : ''} locked={byKey.get(u.roleKey)?.locked} />
                          </TableCell>
                          <TableCell>
                            {u.roleKey === 'nhq' ? (
                              <Typography sx={{ color: colors.brandDark, fontSize: 13, fontWeight: 600 }}>All clients</Typography>
                            ) : u.clients.length === 0 ? (
                              <Typography sx={{ color: colors.subtle, fontSize: 13 }}>None</Typography>
                            ) : (
                              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {u.clients.slice(0, 2).map((c) => (
                                  <Chip key={c} size="small" label={clientLabel(c)} variant="outlined" />
                                ))}
                                {u.clients.length > 2 && <Chip size="small" label={`+${u.clients.length - 2}`} />}
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                              <ActiveChip active={u.active} />
                              {!u.hasPassword ? (
                                <Chip size="small" label="No password" variant="outlined" sx={{ color: colors.muted }} />
                              ) : u.mustChangePassword ? (
                                <Chip size="small" label="Temp password" variant="outlined" color="warning" />
                              ) : null}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!!data?.total && <Pager count={data.total} page={page} onPage={setPage} />}
        </>
      )}

      {editing && (
        <UserDrawer
          key={editing === 'new' ? 'new' : editing.key}
          open
          user={editing === 'new' ? null : editing}
          roles={roles}
          selfId={me?.id}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
