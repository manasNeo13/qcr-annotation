import { useState } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import ListIcon from '@mui/icons-material/TableRowsOutlined';
import LayersIcon from '@mui/icons-material/LayersOutlined';
import { useAuth } from '../auth/AuthContext';
import { brandGrad, colors } from '../theme';

const NAV = [
  { key: 'documents', label: 'Filter Table', to: '/documents', icon: <ListIcon fontSize="small" /> },
  { key: 'annotation', label: 'Annotation', to: '/annotation', icon: <LayersIcon fontSize="small" /> },
] as const;

/** Header tabs. Detail page opened from Annotation (ean+batch in URL) counts as Annotation. */
function NavTabs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = pathname.startsWith('/annotation') || (pathname.startsWith('/documents/') && params.get('ean'))
    ? 'annotation'
    : 'documents';
  return (
    <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 0.5, justifySelf: 'center' }}>
      {NAV.map((n) => {
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

export default function AppLayout() {
  const { user, logout } = useAuth();
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
            <Typography
              component="span"
              sx={{
                display: { xs: 'none', sm: 'inline' },
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
                color: colors.brandDark,
                bgcolor: colors.brandSoft,
                px: 1,
                py: 0.25,
                borderRadius: '5px',
              }}
            >
              Annotation
            </Typography>
          </Box>

          <NavTabs />

          <ButtonBase
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label="Account menu"
            aria-haspopup="menu"
            sx={{ justifySelf: 'end', maxWidth: '100%', minWidth: 0, borderRadius: 999, p: 0.5, pr: { xs: 0.5, sm: 1.5 }, gap: 1, '&:hover': { bgcolor: colors.background } }}
          >
            <Avatar sx={{ width: 34, height: 34, fontSize: 14, fontWeight: 700, background: brandGrad }}>{initials}</Avatar>
            <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'left', lineHeight: 1.2, minWidth: 0, overflow: 'hidden' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: colors.textDark, lineHeight: 1.2 }}>
                {user?.name}
              </Typography>
              <Typography sx={{ fontSize: 12, color: colors.muted, lineHeight: 1.2 }}>{user?.email}</Typography>
            </Box>
          </ButtonBase>
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
            </Box>
            <Divider />
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
        <Outlet />
      </Box>
    </Box>
  );
}
