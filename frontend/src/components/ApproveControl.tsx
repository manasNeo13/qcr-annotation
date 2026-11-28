/**
 * Approve button / "Approved" tag for one side of a capture (Metadata or GRN).
 * Approved → green tag (who + when on hover, "Auto" when values matched GRN). Otherwise → Approve button.
 */
import { Box, Button, CircularProgress, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import type { Approval } from '../types';
import { formatDateTime } from '../utils/format';

const OK = { bg: '#ecfdf5', border: '#a7f3d0', text: '#007849' };

export default function ApproveControl({
  approved,
  approval,
  canApprove,
  pending,
  onApprove,
  label,
}: {
  approved: boolean;
  approval: Approval | null | undefined;
  canApprove: boolean;
  pending: boolean;
  onApprove: () => void;
  /** Screen-reader name, e.g. "metadata". */
  label: string;
}) {
  if (approved) {
    const auto = approval?.source === 'auto';
    const who = auto ? 'Approved automatically — values matched GRN' : `Approved by ${approval?.by ?? '—'}`;
    return (
      <Tooltip title={`${who}${approval?.at ? ` · ${formatDateTime(approval.at)}` : ''}`}>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: '20px',
            fontSize: 12,
            fontWeight: 700,
            bgcolor: OK.bg,
            color: OK.text,
            border: `1px solid ${OK.border}`,
            whiteSpace: 'nowrap',
          }}
        >
          <CheckIcon sx={{ fontSize: 14 }} />
          {auto ? 'Auto approved' : 'Approved'}
        </Box>
      </Tooltip>
    );
  }
  if (!canApprove) return null;
  return (
    <Button
      size="small"
      variant="outlined"
      color="primary"
      onClick={onApprove}
      disabled={pending}
      aria-label={`Approve ${label}`}
      startIcon={pending ? <CircularProgress size={12} thickness={5} /> : <CheckIcon sx={{ fontSize: '16px !important' }} />}
      sx={{ py: 0.25, minHeight: 0, fontWeight: 700, borderRadius: '20px' }}
    >
      {pending ? 'Approving…' : 'Approve'}
    </Button>
  );
}
