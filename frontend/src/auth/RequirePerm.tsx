import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/LockOutlined';
import { colors } from '../theme';
import { homePath, type Permission } from '../utils/permissions';
import { useAuth } from './AuthContext';
import { useAccess } from './useAccess';

/** Renders children when user has ANY of `perms`; else redirects to their first allowed page. */
export default function RequirePerm({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { permissions, loading, error, canAny } = useAccess();
  const { logout } = useAuth();
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 560, mx: 'auto', mt: 4 }}>
        Could not load your access. Refresh the page.
      </Alert>
    );
  }
  if (canAny(...perms)) return <>{children}</>;
  const home = homePath(permissions);
  if (home) return <Navigate to={home} replace />;
  return (
    <Paper sx={{ maxWidth: 520, mx: 'auto', mt: 6, p: 4, textAlign: 'center' }}>
      <LockIcon sx={{ fontSize: 44, color: colors.subtle }} />
      <Typography variant="h5" sx={{ mt: 1 }}>
        No access yet
      </Typography>
      <Typography sx={{ color: colors.muted, mt: 0.5 }}>
        Your role has no pages enabled. Ask an admin to give your role access.
      </Typography>
      <Button sx={{ mt: 2 }} variant="outlined" onClick={logout}>
        Sign out
      </Button>
    </Paper>
  );
}
