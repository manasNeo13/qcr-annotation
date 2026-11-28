/**
 * GRN data (client revalidation upload) under the metadata section.
 * Changed fields in amber. Approve → GRN values become the capture's values (blank GRN fields keep the current value).
 */
import { Box, Paper, Typography } from '@mui/material';
import type { Approval, GrnData } from '../types';
import { colors } from '../theme';
import { formatDate } from '../utils/format';
import ApproveControl from './ApproveControl';

const AMBER = { bg: '#fffbeb', border: '#fcd34d', label: '#92400e', value: '#b45309' };

function GrnField({ label, value, changed, mono }: { label: string; value: string; changed: boolean; mono?: boolean }) {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: '8px',
        bgcolor: changed ? AMBER.bg : colors.surface2,
        border: `1px solid ${changed ? AMBER.border : colors.border}`,
        minWidth: 0,
        transition: 'background .2s, border-color .2s',
      }}
    >
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: changed ? AMBER.label : colors.muted }}>
        {label}
        {changed && (
          <Box component="span" sx={{ ml: 0.75, fontSize: 11, fontWeight: 700, color: AMBER.value }}>
            ● Changed
          </Box>
        )}
      </Typography>
      <Typography
        sx={{
          fontSize: 17,
          fontWeight: 600,
          color: changed ? AMBER.value : colors.textDark,
          wordBreak: 'break-word',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        }}
      >
        {value || '—'}
      </Typography>
    </Box>
  );
}

const tagSx = { px: 1, py: 0.2, borderRadius: '20px', fontSize: 12, fontWeight: 700 } as const;

export default function GrnPanel({
  grn,
  approved,
  approval,
  canApprove,
  pending,
  onApprove,
}: {
  grn: GrnData;
  approved: boolean;
  approval: Approval | null | undefined;
  canApprove: boolean;
  pending: boolean;
  onApprove: () => void;
}) {
  const edited = grn.batchChanged || grn.mfdChanged || grn.expChanged || grn.mrpChanged;
  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h2">
          GRN Data
        </Typography>
        {edited ? (
          <Box component="span" sx={{ ...tagSx, bgcolor: AMBER.bg, color: AMBER.value, border: `1px solid ${AMBER.border}` }}>
            Edited
          </Box>
        ) : (
          <Box component="span" sx={{ ...tagSx, bgcolor: '#ecfdf5', color: '#007849', border: '1px solid #a7f3d0' }}>
            No changes
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <ApproveControl approved={approved} approval={approval} canApprove={canApprove} pending={pending} onApprove={onApprove} label="GRN values" />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: { xs: 1, sm: 1.5 } }}>
        <GrnField label="Manufacturing date" value={grn.mfd ? formatDate(grn.mfd) : ''} changed={grn.mfdChanged} />
        <GrnField label="Expiry date" value={grn.exp ? formatDate(grn.exp) : ''} changed={grn.expChanged} />
        <GrnField label="Batch number" value={grn.batch ?? ''} changed={grn.batchChanged} mono />
        <GrnField label="MRP" value={grn.mrp != null ? `₹${Number(grn.mrp).toFixed(2)}` : ''} changed={grn.mrpChanged} />
      </Box>
      {canApprove && !approved && (
        <Typography sx={{ fontSize: 12, color: colors.muted, mt: 1.5 }}>
          Approve GRN → these values replace the metadata above (empty GRN fields keep the current value).
        </Typography>
      )}
    </Paper>
  );
}
