import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import type { RoleInfo } from '../../types';
import { DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_INFO, type Permission } from '../../utils/permissions';
import { ADMIN_KEYS } from './keys';

/** New role: name + permission checkboxes (defaults: everything except Manage users). */
function NewRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<Permission[]>(DEFAULT_PERMISSIONS);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => adminApi.createRole(name.trim(), perms),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Role created');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create role'),
  });
  const toggle = (p: Permission) => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <DialogTitle>New role</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            label="Role name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 50 } }}
            sx={{ mt: 1 }}
          />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: colors.muted, mt: 0.5 }}>Permissions</Typography>
          {PERMISSIONS.map((p) => (
            <FormControlLabel
              key={p}
              control={<Checkbox checked={perms.includes(p)} onChange={() => toggle(p)} />}
              label={
                <Box>
                  <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>{PERMISSION_INFO[p].label}</Typography>
                  <Typography sx={{ fontSize: 12, color: colors.muted }}>{PERMISSION_INFO[p].hint}</Typography>
                </Box>
              }
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button color="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!name.trim() || create.isPending}
            startIcon={create.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Create role
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: RoleInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => adminApi.deleteRole(role.key),
    onSuccess: ({ moved }) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(moved ? `Role deleted · ${moved} users moved to No role` : 'Role deleted');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not delete role'),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete role “{role.name}”?</DialogTitle>
      <DialogContent>
        <Typography>
          {role.users
            ? `${role.users} user${role.users === 1 ? '' : 's'} will move to “No role” (also in the main QCR app).`
            : 'No users have this role.'}
        </Typography>
        {role.variants.length > 1 && (
          <Typography sx={{ mt: 1, fontSize: 13, color: colors.muted }}>Includes spellings: {role.variants.join(', ')}</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => del.mutate()}
          disabled={del.isPending}
          startIcon={del.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Delete role
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Roles × permissions grid. Ticks save instantly. Admin roles locked to full access. */
export default function RolesTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RoleInfo | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ADMIN_KEYS.roles, queryFn: adminApi.roles });

  const update = useMutation({
    mutationFn: ({ key, perms }: { key: string; perms: Permission[] }) => adminApi.updateRole(key, perms),
    onMutate: ({ key }) => setSaving(key),
    onSuccess: (role) => {
      qc.setQueryData(ADMIN_KEYS.roles, (old: typeof data) =>
        old ? { ...old, roles: old.roles.map((r) => (r.key === role.key ? { ...r, permissions: role.permissions } : r)) } : old,
      );
      qc.invalidateQueries({ queryKey: ADMIN_KEYS.audit });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(`${role.name} updated`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
    onSettled: () => setSaving(null),
  });

  const toggle = (r: RoleInfo, p: Permission) =>
    update.mutate({ key: r.key, perms: r.permissions.includes(p) ? r.permissions.filter((x) => x !== p) : [...r.permissions, p] });

  return (
    <>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ fontSize: 13, color: colors.muted, flex: '1 1 300px' }}>
          Tick to allow. Changes save instantly and apply within a minute. NHQ / Admin always have full access. Roles with
          different spellings (e.g. store_manager / Store_manager) are shown as one.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          New role
        </Button>
      </Box>
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
          {(error as Error)?.message || 'Could not load roles.'}
        </Alert>
      ) : (
        <TableContainer sx={{ overflowX: 'auto', borderTop: `1px solid ${colors.border}` }}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Role</TableCell>
                <TableCell align="right">Users</TableCell>
                {PERMISSIONS.map((p) => (
                  <TableCell key={p} align="center" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={PERMISSION_INFO[p].hint}>
                      <span>{PERMISSION_INFO[p].label}</span>
                    </Tooltip>
                  </TableCell>
                ))}
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={PERMISSIONS.length + 3}>
                        <Skeleton height={32} />
                      </TableCell>
                    </TableRow>
                  ))
                : data?.roles.map((r) => (
                    <TableRow key={r.key || '~none'} hover sx={{ bgcolor: r.locked ? colors.brandSoft : undefined }}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                          {r.locked && <LockIcon sx={{ fontSize: 16, color: colors.brandDark }} />}
                          <Typography sx={{ fontWeight: 700, color: r.key ? colors.textDark : colors.muted }}>{r.name}</Typography>
                          {r.custom && <Chip size="small" label="Custom" sx={{ height: 18, fontSize: 11 }} />}
                          {saving === r.key && <CircularProgress size={14} />}
                        </Box>
                        {r.variants.length > 1 && (
                          <Typography sx={{ fontSize: 11.5, color: colors.muted }}>also: {r.variants.slice(1).join(', ')}</Typography>
                        )}
                        {r.key === '' && (
                          <Typography sx={{ fontSize: 11.5, color: colors.muted }}>Users with blank role</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{r.users}</TableCell>
                      {PERMISSIONS.map((p) => (
                        <TableCell key={p} align="center" sx={{ py: 0 }}>
                          <Checkbox
                            size="small"
                            checked={r.permissions.includes(p)}
                            disabled={r.locked || saving === r.key}
                            onChange={() => toggle(r, p)}
                            slotProps={{ input: { 'aria-label': `${r.name}: ${PERMISSION_INFO[p].label}` } }}
                          />
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={{ py: 0 }}>
                        {r.deletable && (
                          <Tooltip title="Delete role">
                            <IconButton size="small" onClick={() => setDeleting(r)} aria-label={`Delete ${r.name}`}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {creating && <NewRoleDialog open onClose={() => setCreating(false)} />}
      {deleting && <DeleteRoleDialog role={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
