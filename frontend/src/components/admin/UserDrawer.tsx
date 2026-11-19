import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import type { AdminUser, AdminUserInput, RoleInfo, StoreOption } from '../../types';
import { clientLabel } from '../../utils/clients';
import { formatDateTime } from '../../utils/format';
import { copyText, generatePassword } from '../../utils/password';
import { newPasswordSchema } from '../../utils/validation';
import { ADMIN_KEYS } from './keys';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Form = AdminUserInput & { id: string; password: string };
const blank: Form = { id: '', name: '', email: '', phone: '', role: '', active: true, stores: [], clients: [], password: '' };
const isNhq = (roleKey: string) => roleKey === 'nhq';

/** First problem with a new password, or undefined. */
const pwError = (pw: string) => {
  const r = newPasswordSchema.safeParse(pw);
  return r.success ? undefined : r.error.issues[0]?.message;
};

/** Client checks (backend re-validates). */
function validate(f: Form, creating: boolean) {
  const e: Partial<Record<keyof Form, string>> = {};
  if (creating && !/^[A-Za-z0-9_.-]{2,40}$/.test(f.id.trim())) e.id = 'Letters, numbers, _ . - (2–40)';
  if (!f.name.trim()) e.name = 'Name is required';
  if (creating && !f.email.trim()) e.email = 'Email is required to sign in';
  else if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = 'Enter a valid email';
  if (!/^[0-9+\- ]*$/.test(f.phone.trim())) e.phone = 'Digits, +, - and spaces only';
  if (creating && !isNhq(f.role) && f.clients.length === 0) e.clients = 'Pick at least one client';
  if (creating) {
    const p = pwError(f.password);
    if (p) e.password = p;
  }
  return e;
}

/** Password box: generate random · copy · show/hide. */
function PasswordInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  helperText?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const copy = async () => {
    if (!props.value) return toast.error('Nothing to copy — type or generate a password');
    if (await copyText(props.value)) toast.success('Password copied');
    else toast.error('Could not copy — select and copy it by hand');
  };
  return (
    <TextField
      label={props.label}
      required={props.required}
      type={show ? 'text' : 'password'}
      autoComplete="new-password"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      error={!!props.error}
      helperText={props.error ?? props.helperText}
      fullWidth
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end" sx={{ gap: 0.25 }}>
              <Tooltip title="Generate random password">
                <IconButton
                  size="small"
                  onClick={() => {
                    props.onChange(generatePassword());
                    setShow(true);
                  }}
                  aria-label="Generate random password"
                >
                  <AutorenewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Copy password">
                <IconButton size="small" onClick={copy} aria-label="Copy password">
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={show ? 'Hide' : 'Show'}>
                <IconButton size="small" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** Edit mode: NHQ gives the user a temporary password (they must change it at next sign-in). */
function TempPasswordSection({ user }: { user: AdminUser }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [tried, setTried] = useState(false);
  const [current, setCurrent] = useState(user);
  const error = tried ? pwError(pw) : undefined;
  const status = !current.hasPassword
    ? 'No password yet — this user cannot sign in.'
    : current.mustChangePassword
      ? 'Temporary password set — they will be asked to change it after signing in.'
      : 'Using their own password.';
  const set = useMutation({
    mutationFn: () => adminApi.setTemporaryPassword(user.key, pw),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Temporary password set — share it with the user');
      setCurrent(u);
      setPw('');
      setTried(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not set password'),
  });
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box>
        <Typography sx={{ fontWeight: 600 }}>Password</Typography>
        <Typography sx={{ fontSize: 12.5, color: colors.muted }}>{status}</Typography>
      </Box>
      {!user.email ? (
        <Typography sx={{ fontSize: 12.5, color: colors.muted }}>Add an email and save first — users sign in with email.</Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <PasswordInput
            label="New temporary password"
            value={pw}
            onChange={setPw}
            error={error}
            helperText="Generate, copy, then Set. User changes it after signing in"
          />
          <Button
            variant="outlined"
            sx={{ height: 40, mt: '8px', flexShrink: 0 }}
            disabled={set.isPending}
            onClick={() => {
              setTried(true);
              if (!pwError(pw)) set.mutate();
            }}
          >
            {set.isPending ? <CircularProgress size={16} /> : 'Set'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

/** Permanent delete, confirmed by typing the user's ID (or name when no ID). */
function DeleteUserDialog({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const word = user.id || user.name;
  const [typed, setTyped] = useState('');
  const del = useMutation({
    mutationFn: () => adminApi.deleteUser(user.key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`${user.name || word} deleted`);
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message || 'Delete failed'),
  });
  return (
    <Dialog open onClose={del.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {user.name || word}?</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: 14 }}>
          This removes the user for good. They can't sign in here or in the main QCR app. Their past captures and edits stay.
        </Typography>
        <Typography sx={{ fontSize: 13, color: colors.muted }}>
          Only want to block sign-in? Close this and switch the user to <b>Inactive</b> instead.
        </Typography>
        <TextField
          size="small"
          label={`Type ${word} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          autoComplete="off"
        />
      </DialogContent>
      <DialogActions>
        <Button color="secondary" onClick={onClose} disabled={del.isPending}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={typed.trim() !== word || del.isPending}
          onClick={() => del.mutate()}
          startIcon={del.isPending ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
        >
          Delete user
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Add / edit user side panel (NHQ only). Writes to shared `users`.
 * Clients = what the user may see here. New users get a temporary password.
 * Self: role + active locked (no lock-out).
 */
export default function UserDrawer({
  open,
  user,
  roles,
  selfId,
  onClose,
}: {
  open: boolean;
  user: AdminUser | null; // null = add
  roles: RoleInfo[];
  selfId?: string;
  onClose: () => void;
}) {
  const creating = !user;
  const self = !!user && user.key === selfId;
  const [form, setForm] = useState<Form>(() =>
    user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.roleKey,
          active: user.active,
          stores: user.stores,
          clients: user.clients,
          password: '',
        }
      : blank,
  );
  const [touched, setTouched] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const errors = validate(form, creating);
  const hasErrors = Object.keys(errors).length > 0;
  const qc = useQueryClient();

  const { data: stores = [] } = useQuery({ queryKey: ADMIN_KEYS.stores, queryFn: adminApi.stores, staleTime: 5 * 60_000 });
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const { data: clientOptions = [] } = useQuery({ queryKey: ADMIN_KEYS.clients, queryFn: adminApi.clients, staleTime: 5 * 60_000 });

  // New user: suggest next free ID (editable). Only fills while the admin hasn't typed their own.
  const [idEdited, setIdEdited] = useState(false);
  const nextId = useQuery({ queryKey: [...ADMIN_KEYS.users, 'next-id'], queryFn: adminApi.nextUserId, enabled: creating, staleTime: 0 });
  useEffect(() => {
    if (creating && !idEdited && nextId.data?.id) setForm((f) => ({ ...f, id: nextId.data.id }));
  }, [creating, idEdited, nextId.data]);

  const save = useMutation({
    mutationFn: () => {
      const body: AdminUserInput = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        role: form.role, // role key; backend stores the existing spelling
        active: form.active,
        stores: form.stores,
        clients: form.clients,
      };
      return creating
        ? adminApi.createUser({ ...body, id: form.id.trim(), password: form.password })
        : adminApi.updateUser(user!.key, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(creating ? 'User added — share the temporary password with them' : 'User updated');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Save failed'),
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: keyof Form) => (touched ? errors[k] : undefined);
  const submit = () => {
    setTouched(true);
    if (!hasErrors) save.mutate();
  };
  const storeLabel = (id: string) => {
    const s = storeById.get(id);
    return s ? `${s.name} · ${s.id}` : id;
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}>
      <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1, borderBottom: `1px solid ${colors.border}` }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5">{creating ? 'Add user' : 'Edit user'}</Typography>
          {!creating && (
            <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
              ID {user.id || '—'}
              {user.createdAt ? ` · added ${formatDateTime(user.createdAt)}` : ''}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Box>

      <Box
        component="form"
        id="user-form"
        noValidate
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}
      >
        {creating && (
          <TextField
            label="User ID"
            required
            value={form.id}
            onChange={(e) => {
              setIdEdited(true);
              set('id', e.target.value);
            }}
            error={!!err('id')}
            helperText={err('id') ?? 'Filled in for you — change if needed. Cannot be changed later'}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Use next free ID">
                      <span>
                        <IconButton
                          size="small"
                          aria-label="Use next free ID"
                          disabled={nextId.isFetching}
                          onClick={() => {
                            setIdEdited(false);
                            void nextId.refetch();
                          }}
                        >
                          {nextId.isFetching ? <CircularProgress size={16} /> : <AutorenewIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={!!err('name')}
          helperText={err('name')}
          autoFocus
        />
        <TextField
          label="Email"
          type="email"
          required={creating}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={!!err('email')}
          helperText={err('email') ?? 'Used to sign in'}
        />
        <TextField
          label="Phone"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={!!err('phone')}
          helperText={err('phone')}
          slotProps={{ htmlInput: { inputMode: 'tel' } }}
        />
        <TextField
          select
          label="Role"
          value={form.role}
          onChange={(e) => set('role', e.target.value)}
          disabled={self}
          helperText={self ? "You can't change your own role" : undefined}
        >
          {roles.map((r) => (
            <MenuItem key={r.key || '~none'} value={r.key}>
              {r.name}
            </MenuItem>
          ))}
        </TextField>
        {isNhq(form.role) ? (
          <Alert severity="success" sx={{ py: 0 }}>
            NHQ sees all clients — no client needed.
          </Alert>
        ) : (
          <Autocomplete
            multiple
            options={clientOptions}
            value={form.clients}
            onChange={(_, v) => set('clients', v)}
            getOptionLabel={clientLabel}
            renderValue={(value, getItemProps) =>
              value.map((c, index) => {
                const { key, ...rest } = getItemProps({ index });
                return <Chip key={key} size="small" label={clientLabel(c)} {...rest} />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Clients"
                required={creating}
                error={!!err('clients')}
                helperText={err('clients') ?? "User sees only these clients' captures"}
              />
            )}
          />
        )}
        {creating && (
          <PasswordInput
            label="Temporary password"
            required
            value={form.password}
            onChange={(v) => set('password', v)}
            error={err('password')}
            helperText="Generate, copy and share — they change it after signing in"
          />
        )}
        <Autocomplete
          multiple
          freeSolo
          options={stores.map((s) => s.id)}
          value={form.stores}
          onChange={(_, v) => set('stores', [...new Set(v.map((x) => String(x).trim()).filter(Boolean))])}
          getOptionLabel={storeLabel}
          groupBy={(id) => ((storeById.get(id) as StoreOption | undefined)?.kind === 'warehouse' ? 'Warehouses' : 'Stores')}
          renderValue={(value, getItemProps) =>
            value.map((id, index) => {
              const { key, ...rest } = getItemProps({ index });
              return <Chip key={key} size="small" label={storeLabel(id)} {...rest} />;
            })
          }
          renderInput={(params) => (
            <TextField {...params} label="Assigned stores" helperText="Pick from list or type a store ID + Enter" />
          )}
        />
        <Divider />
        <FormControlLabel
          control={<Switch checked={form.active} onChange={(e) => set('active', e.target.checked)} disabled={self} />}
          label={
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{form.active ? 'Active' : 'Inactive'}</Typography>
              <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
                {self ? "You can't deactivate yourself" : 'Inactive users cannot sign in'}
              </Typography>
            </Box>
          }
        />
        {!creating && (
          <>
            <Divider />
            <TempPasswordSection user={user} />
          </>
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', gap: 1, justifyContent: 'flex-end', borderTop: `1px solid ${colors.border}` }}>
        {!creating && !self && (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting(true)} sx={{ mr: 'auto' }}>
            Delete
          </Button>
        )}
        <Button color="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="user-form"
          variant="contained"
          disabled={save.isPending || (touched && hasErrors)}
          startIcon={save.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {creating ? 'Add user' : 'Save'}
        </Button>
      </Box>
      {deleting && user && (
        <DeleteUserDialog
          user={user}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onClose();
          }}
        />
      )}
    </Drawer>
  );
}
