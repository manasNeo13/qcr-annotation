import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import type { AdminUser, AdminUserInput, RoleInfo, StoreOption } from '../../types';
import { formatDateTime } from '../../utils/format';
import { ADMIN_KEYS } from './keys';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Form = AdminUserInput & { id: string };
const blank: Form = { id: '', name: '', email: '', phone: '', role: '', active: true, stores: [] };

/** Client checks (backend re-validates). */
function validate(f: Form, creating: boolean) {
  const e: Partial<Record<keyof Form, string>> = {};
  if (creating && !/^[A-Za-z0-9_.-]{2,40}$/.test(f.id.trim())) e.id = 'Letters, numbers, _ . - (2–40)';
  if (!f.name.trim()) e.name = 'Name is required';
  if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = 'Enter a valid email';
  if (!/^[0-9+\- ]*$/.test(f.phone.trim())) e.phone = 'Digits, +, - and spaces only';
  return e;
}

/**
 * Add / edit user side panel. Writes to shared `users` (main QCR app sees changes).
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
    user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.roleKey, active: user.active, stores: user.stores } : blank,
  );
  const [touched, setTouched] = useState(false);
  const errors = validate(form, creating);
  const hasErrors = Object.keys(errors).length > 0;
  const qc = useQueryClient();

  const { data: stores = [] } = useQuery({ queryKey: ADMIN_KEYS.stores, queryFn: adminApi.stores, staleTime: 5 * 60_000 });
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const save = useMutation({
    mutationFn: () => {
      const body: AdminUserInput = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        role: form.role, // role key; backend stores the existing spelling
        active: form.active,
        stores: form.stores,
      };
      return creating ? adminApi.createUser({ ...body, id: form.id.trim() }) : adminApi.updateUser(user!.key, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(creating ? 'User added' : 'User updated');
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
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}
      >
        <Alert severity="info" sx={{ py: 0 }}>
          Users are shared with the main QCR app — changes apply there too.
        </Alert>
        {creating && (
          <TextField
            label="User ID"
            required
            value={form.id}
            onChange={(e) => set('id', e.target.value)}
            error={!!err('id')}
            helperText={err('id') ?? 'Unique, cannot be changed later'}
            autoFocus
          />
        )}
        <TextField
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={!!err('name')}
          helperText={err('name')}
          autoFocus={!creating}
        />
        <TextField
          label="Email"
          type="email"
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
        {!creating && !user.hasPassword && (
          <Typography sx={{ fontSize: 12.5, color: colors.muted }}>No password set — this user cannot sign in here yet.</Typography>
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', gap: 1, justifyContent: 'flex-end', borderTop: `1px solid ${colors.border}` }}>
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
    </Drawer>
  );
}
