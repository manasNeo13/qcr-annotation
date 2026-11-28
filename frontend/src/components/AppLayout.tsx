import { useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import KeyIcon from '@mui/icons-material/KeyOutlined';
import ListIcon from '@mui/icons-material/TableRowsOutlined';
import StatsIcon from '@mui/icons-material/InsertChartOutlined';
import AccuracyIcon from '@mui/icons-material/FactCheckOutlined';
import UsersIcon from '@mui/icons-material/ManageAccountsOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFileOutlined';
import { useAuth } from '../auth/AuthContext';
import { useAccess } from '../auth/useAccess';
import { api } from '../api';
import type { Permission } from '../utils/permissions';
import { brandGrad, colors } from '../theme';
import { clientLabel } from '../utils/clients';
import { formatDate } from '../utils/format';

const NAV: { key: string; label: string; to: string; icon: ReactNode; perm: Permission }[] = [
  { key: 'documents', label: 'Annotation Table', to: '/documents', icon: <ListIcon fontSize="small" />, perm: 'view_documents' },
  // Annotation (EAN → batch drill-down) hidden from the header for now (user decision 2026-11-26); route still works.
  { key: 'stats', label: 'Edit Stats', to: '/stats', icon: <StatsIcon fontSize="small" />, perm: 'view_stats' },
  { key: 'accuracy', label: 'Accuracy', to: '/accuracy', icon: <AccuracyIcon fontSize="small" />, perm: 'view_accuracy' },
  { key: 'users', label: 'Users', to: '/users', icon: <UsersIcon fontSize="small" />, perm: 'manage_users' },
];

/** Header tabs. Detail page opened from Annotation (ean+batch in URL) counts as Annotation. */
function NavTabs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { can } = useAccess();
  const active = pathname.startsWith('/users')
    ? 'users'
    : pathname.startsWith('/stats')
    ? 'stats'
    : pathname.startsWith('/accuracy') || (pathname.startsWith('/documents/') && params.get('src') === 'accuracy')
    ? 'accuracy'
    : pathname.startsWith('/annotation') || (pathname.startsWith('/documents/') && params.get('ean'))
      ? 'annotation'
      : 'documents';
  return (
    <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 0.5, justifySelf: 'center' }}>
      {NAV.filter((n) => can(n.perm)).map((n) => {
        const on = active === n.key;
        return (
          <Button
            key={n.key}
            component={RouterLink}
            to={n.to}
            size="small"
            startIcon={n.icon}
            aria-current={on ? 'page' : undefined}
            sx={{
              px: { xs: 1, sm: 1.5 },
              minWidth: 0,
              fontWeight: 700,
              color: on ? colors.brandDark : colors.muted,
              bgcolor: on ? colors.brandSoft : 'transparent',
              '&:hover': { bgcolor: on ? colors.brandSoft : colors.background },
              '& .MuiButton-startIcon': { mr: { xs: 0.5, sm: 1 }, display: { xs: 'none', sm: 'inherit' } },
            }}
          >
            {n.label}
          </Button>
        );
      })}
    </Box>
  );
}

type SnackState = { open: boolean; severity: 'success' | 'warning' | 'error'; message: string; days?: { date: string; count: number }[] };

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { me } = useAccess();
  // Non-NHQ users see only their assigned clients.
  // Split team members see every client's old captures → no client notice.
  const myClients = me && !me.superAdmin && !me.splitTeam ? me.clients : null;
  const noClient = !!myClients && myClients.length === 0;
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Manual sign-out: fresh start next login (no return-to-last-page, no cached data).
  const signOut = () => {
    setAnchor(null);
    navigate('/login', { replace: true });
    logout();
    qc.clear();
  };
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const initials = (user?.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // ── Upload GRN revalidation data ──────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const [snack, setSnack] = useState<SnackState>({ open: false, severity: 'success', message: '' });

  const handleUploadClick = () => fileInputRef.current?.click();

  /** One or more .xlsx files, sent one after another (same capture in 2 files → last file wins). */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
    setUploading(true);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let auto = 0;
    const days = new Map<string, number>();
    const failed: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setUploadStep(files.length > 1 ? `${i + 1}/${files.length}` : '');
        try {
          const r = await api.uploadClientRevalidateData(file);
          inserted += r.inserted;
          updated += r.updated;
          skipped += r.skipped;
          auto += r.autoApproved ?? 0;
          for (const d of r.byDay ?? []) days.set(d.date, (days.get(d.date) ?? 0) + d.count);
          if (files.length === 1) {
            setSnack({
              open: true,
              severity: 'success',
              message: `${r.message} — ${r.inserted} inserted, ${r.updated} updated${r.autoApproved ? `, ${r.autoApproved} auto approved (values = GRN)` : ''}`,
              days: r.byDay ?? [],
            });
          }
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`);
        }
      }
      const ok = files.length - failed.length;
      const dayList = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
      if (ok) {
        qc.invalidateQueries({ queryKey: ['documents'] });
        qc.invalidateQueries({ queryKey: ['document'] });
        qc.invalidateQueries({ queryKey: ['accuracy'] });
      }
      if (files.length > 1 || failed.length) {
        const done = ok ? `${ok} of ${files.length} files uploaded — ${inserted} inserted, ${updated} updated, ${skipped} skipped rows${auto ? `, ${auto} auto approved` : ''}` : '';
        setSnack({
          open: true,
          severity: !failed.length ? 'success' : ok ? 'warning' : 'error',
          message: [done, ...(failed.length ? [`Failed: ${failed.join(' · ')}`] : [])].filter(Boolean).join('. '),
          days: dayList,
        });
      }
    } finally {
      setUploading(false);
      setUploadStep('');
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{ bgcolor: 'rgba(255,255,255,.9)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${colors.border}` }}
      >
        {/* 3 columns: logo | nav (true centre) | account */}
        <Toolbar
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
            alignItems: 'center',
            gap: { xs: 1, sm: 2 },
            minHeight: { xs: 60, sm: 68 },
            px: { xs: 2, sm: 3, lg: 4 },
          }}
        >
          <Box
            component={RouterLink}
            to="/documents"
            sx={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 1.25, minWidth: 0, justifySelf: 'start' }}
          >
            <Typography
              component="span"
              sx={{ font: "800 22px/1 'Baloo 2', sans-serif", letterSpacing: '-0.4px', color: colors.textPrimary }}
            >
              Neo
              <Box
                component="span"
                sx={{ background: brandGrad, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
              >
                QCR
              </Box>
            </Typography>
          </Box>

          <NavTabs />

          {/* Right column: upload + account */}
          <Box sx={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {me?.grnUpload && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  multiple
                  hidden
                  onChange={handleFileChange}
                />
                <Tooltip title="Upload GRN revalidation data (.xlsx, one or more files)" disableHoverListener={uploading}>
                  <span>
                    <Button
                      onClick={handleUploadClick}
                      disabled={uploading}
                      size="small"
                      startIcon={
                        uploading
                          ? <CircularProgress size={14} thickness={5} sx={{ color: colors.brandDark }} />
                          : <UploadFileIcon sx={{ fontSize: '16px !important' }} />
                      }
                      aria-label="Upload GRN revalidation data"
                      sx={{
                        px: 1.5,
                        py: 0.6,
                        minHeight: 0,
                        minWidth: 0,
                        borderRadius: '20px',
                        fontSize: 13,
                        fontWeight: 700,
                        color: colors.brandDark,
                        bgcolor: colors.brandSoft,
                        border: `1.5px solid ${colors.brand100}`,
                        boxShadow: 'none',
                        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } },
                        '&:hover': {
                          bgcolor: '#d1fae5',
                          border: `1.5px solid ${colors.primary}`,
                          boxShadow: '0 2px 8px rgba(0,172,105,.18)',
                        },
                        '&.Mui-disabled': {
                          bgcolor: colors.brandSoft,
                          border: `1.5px solid ${colors.brand100}`,
                          color: colors.primary,
                          opacity: 0.7,
                        },
                        transition: 'all .18s',
                      }}
                    >
                      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        {uploading ? `Uploading${uploadStep ? ` ${uploadStep}` : ''}…` : 'Upload GRN'}
                      </Box>
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}

            <ButtonBase
              onClick={(e) => setAnchor(e.currentTarget)}
              aria-label="Account menu"
              aria-haspopup="menu"
              sx={{ maxWidth: '100%', minWidth: 0, borderRadius: 999, p: 0.5, pr: { xs: 0.5, sm: 1.5 }, gap: 1, '&:hover': { bgcolor: colors.background } }}
            >
              <Avatar sx={{ width: 34, height: 34, fontSize: 14, fontWeight: 700, background: brandGrad }}>{initials}</Avatar>
              <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'left', lineHeight: 1.2, minWidth: 0, overflow: 'hidden' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: colors.textDark, lineHeight: 1.2 }}>
                  {user?.name}
                </Typography>
                <Typography sx={{ fontSize: 12, color: colors.muted, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {myClients && myClients.length > 0 ? myClients.map(clientLabel).join(', ') : user?.email}
                </Typography>
              </Box>
            </ButtonBase>
          </Box>
          <Menu
            anchorEl={anchor}
            open={!!anchor}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 220 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography sx={{ fontWeight: 600, color: colors.textDark }}>{user?.name}</Typography>
              <Typography sx={{ fontSize: 12, color: colors.muted, wordBreak: 'break-all' }}>{user?.email}</Typography>
              {myClients && myClients.length > 0 && (
                <Typography sx={{ fontSize: 12, color: colors.brandDark, fontWeight: 600, mt: 0.5 }}>
                  {myClients.length > 1 ? 'Clients' : 'Client'}: {myClients.map(clientLabel).join(', ')}
                </Typography>
              )}
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setAnchor(null);
                navigate('/change-password');
              }}
            >
              <ListItemIcon>
                <KeyIcon fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>
            <MenuItem onClick={signOut}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flex: 1, width: '100%', maxWidth: 1440, mx: 'auto', px: { xs: 1.5, sm: 3, lg: 4 }, py: { xs: 2, sm: 3 } }}>
        {noClient ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            No client is linked to your account yet, so there is nothing to show. Ask your NHQ admin to assign a client.
          </Alert>
        ) : (
          <Outlet />
        )}
      </Box>

      <Snackbar
        open={snack.open}
        // Longer read time when the capture-day summary is shown; errors stay until closed (×).
        autoHideDuration={snack.severity === 'success' ? (snack.days?.length ? 20000 : 10000) : null}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snack.message}
          {!!snack.days?.length && (
            <Box sx={{ mt: 0.75 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>GRN added for captures of:</Typography>
              <Box
                component="ul"
                sx={{ m: 0, mt: 0.25, pl: 2.25, maxHeight: 160, overflowY: 'auto', fontSize: 13, columns: snack.days.length > 6 ? 2 : 1 }}
              >
                {snack.days.map((d) => (
                  <li key={d.date}>
                    {d.date === 'unknown' ? 'Unknown date' : formatDate(d.date)} — {d.count.toLocaleString()} capture{d.count === 1 ? '' : 's'}
                  </li>
                ))}
              </Box>
            </Box>
          )}
        </Alert>
      </Snackbar>
    </Box>
  );
}
