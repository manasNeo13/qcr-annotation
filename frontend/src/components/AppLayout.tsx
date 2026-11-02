import { useState } from 'react';
import { Link as RouterLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AppBar,
  Avatar,
  Box,
  ButtonBase,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import { useAuth } from '../auth/AuthContext';
import { brandGrad, colors } from '../theme';

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
        <Toolbar sx={{ gap: 2, minHeight: { xs: 60, sm: 68 }, px: { xs: 2, sm: 3, lg: 4 } }}>
          <Box
            component={RouterLink}
            to="/documents"
            sx={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 1.25, minWidth: 0 }}
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

          <Box sx={{ flex: 1 }} />

          <ButtonBase
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label="Account menu"
            aria-haspopup="menu"
            sx={{ borderRadius: 999, p: 0.5, pr: { xs: 0.5, sm: 1.5 }, gap: 1, '&:hover': { bgcolor: colors.background } }}
          >
            <Avatar sx={{ width: 34, height: 34, fontSize: 14, fontWeight: 700, background: brandGrad }}>{initials}</Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'left', lineHeight: 1.2 }}>
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
