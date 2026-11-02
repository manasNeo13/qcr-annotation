import { Box } from '@mui/material';
import type { DocStatus } from '../types';
import { STATUS_META } from '../utils/status';

export default function StatusChip({ status, size = 'small' }: { status: DocStatus; size?: 'small' | 'medium' }) {
  const m = STATUS_META[status];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: size === 'small' ? 1 : 1.25,
        py: size === 'small' ? 0.25 : 0.5,
        borderRadius: '4px',
        bgcolor: m.bg,
        color: m.fg,
        fontWeight: 600,
        fontSize: size === 'small' ? '0.75rem' : '0.8125rem',
        whiteSpace: 'nowrap',
        lineHeight: 1.6,
      }}
    >
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: m.dot, flexShrink: 0 }} />
      {m.label}
    </Box>
  );
}
