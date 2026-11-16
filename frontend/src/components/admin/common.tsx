import { Chip, TablePagination } from '@mui/material';
import LockIcon from '@mui/icons-material/LockOutlined';
import { colors } from '../../theme';
import { ADMIN_PAGE_SIZE } from './keys';

export function RoleChip({ name, locked }: { name: string; locked?: boolean }) {
  const none = !name;
  return (
    <Chip
      size="small"
      icon={locked ? <LockIcon sx={{ fontSize: '14px !important' }} /> : undefined}
      label={name || 'No role'}
      variant="outlined"
      sx={{
        fontWeight: 600,
        color: none ? colors.subtle : locked ? colors.brandDark : colors.textPrimary,
        borderColor: locked ? colors.brand100 : colors.border,
        bgcolor: locked ? colors.brandSoft : '#fff',
      }}
    />
  );
}

export function ActiveChip({ active }: { active: boolean }) {
  return (
    <Chip
      size="small"
      label={active ? 'Active' : 'Inactive'}
      sx={{
        fontWeight: 600,
        bgcolor: active ? colors.brandSoft : colors.surface2,
        color: active ? colors.brandDark : colors.subtle,
        border: `1px solid ${active ? colors.brand100 : colors.border}`,
      }}
    />
  );
}

export function Pager({ count, page, onPage }: { count: number; page: number; onPage: (p: number) => void }) {
  return (
    <TablePagination
      component="div"
      count={count}
      page={Math.min(page - 1, Math.max(0, Math.ceil(count / ADMIN_PAGE_SIZE) - 1))}
      rowsPerPage={ADMIN_PAGE_SIZE}
      rowsPerPageOptions={[]}
      onPageChange={(_, p) => onPage(p + 1)}
      sx={{
        borderTop: `1px solid ${colors.border}`,
        '.MuiTablePagination-toolbar': { px: { xs: 1, sm: 2 }, flexWrap: 'wrap', justifyContent: 'flex-end' },
      }}
    />
  );
}
