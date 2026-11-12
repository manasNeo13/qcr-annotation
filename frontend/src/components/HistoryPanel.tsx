import { Box, Paper, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import type { DocMetadata, DocumentItem } from '../types';
import { formatDate, formatDateTime, formatMRP } from '../utils/format';
import { colors } from '../theme';

const FIELDS: { key: keyof DocMetadata; label: string; fmt: (v: DocMetadata) => string }[] = [
  { key: 'mfgDate', label: 'MFG date', fmt: (m) => formatDate(m.mfgDate) },
  { key: 'expiryDate', label: 'Expiry date', fmt: (m) => formatDate(m.expiryDate) },
  { key: 'batchNumber', label: 'Batch no.', fmt: (m) => m.batchNumber },
  { key: 'mrp', label: 'MRP', fmt: (m) => formatMRP(m.mrp) },
];

export default function HistoryPanel({ doc }: { doc: DocumentItem }) {
  // Build version timeline: each history entry → the version that replaced it.
  const versions = [...doc.history, { version: doc.version, metadata: doc.metadata, editedBy: doc.updatedBy ?? 'system', editedAt: doc.updatedAt }];
  const changes = versions
    .slice(1)
    .map((v, i) => {
      const prev = versions[i];
      const diff = FIELDS.filter((f) => prev.metadata[f.key] !== v.metadata[f.key]).map((f) => ({
        label: f.label,
        from: f.fmt(prev.metadata),
        to: f.fmt(v.metadata),
      }));
      return { ...v, diff };
    })
    .reverse();

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <HistoryIcon sx={{ color: colors.muted }} />
        <Typography variant="h5" component="h2">
          Edit history
        </Typography>
      </Box>

      {changes.length === 0 ? (
        <Typography sx={{ color: colors.muted }}>No edits yet. Original extracted values are shown above.</Typography>
      ) : (
        <Box
          component="ol"
          aria-label="Edit history"
          tabIndex={0} // keyboard scrolling
          sx={{
            listStyle: 'none',
            m: 0,
            // Left/top room so the latest dot's ring isn't clipped; right room for the scrollbar.
            p: '4px 8px 4px 4px',
            position: 'relative',
            maxHeight: { xs: 280, md: 360 },
            overflowY: 'auto',
            '&:focus-visible': { outline: `2px solid ${colors.primary}`, outlineOffset: 2, borderRadius: '4px' },
          }}
        >
          {changes.map((c, idx) => (
            <Box
              component="li"
              key={c.version}
              sx={{
                position: 'relative',
                pl: 3,
                pb: idx === changes.length - 1 ? 0 : 2.5,
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 5,
                  top: 8,
                  bottom: idx === changes.length - 1 ? 'auto' : -8,
                  height: idx === changes.length - 1 ? 0 : 'auto',
                  width: 2,
                  bgcolor: colors.border,
                },
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 6,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: idx === 0 ? colors.primary : colors.borderStrong,
                  boxShadow: idx === 0 ? '0 0 0 4px rgba(0,172,105,.15)' : 'none',
                }}
              />
              <Typography sx={{ fontWeight: 600, color: colors.textDark }}>
                v{c.version} · {c.editedBy}
              </Typography>
              <Typography sx={{ fontSize: 12, color: colors.muted, mb: 0.75 }}>{formatDateTime(c.editedAt)}</Typography>
              {c.diff.length === 0 ? (
                <Typography sx={{ fontSize: 13, color: colors.muted }}>Saved with no value changes.</Typography>
              ) : (
                c.diff.map((d) => (
                  <Box key={d.label} sx={{ fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'baseline' }}>
                    <Box component="span" sx={{ color: colors.muted, minWidth: 84 }}>
                      {d.label}
                    </Box>
                    <Box component="del" sx={{ color: '#a20e00', bgcolor: '#fff5f5', px: 0.5, borderRadius: '4px' }}>
                      {d.from}
                    </Box>
                    <span aria-hidden>→</span>
                    <Box component="ins" sx={{ textDecoration: 'none', color: colors.brandDark, bgcolor: colors.brandSoft, px: 0.5, borderRadius: '4px', fontWeight: 600 }}>
                      {d.to}
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          ))}
        </Box>
      )}

      {doc.history.length > 0 && (
        <Box sx={{ mt: 2.5, p: 1.5, borderRadius: '8px', bgcolor: colors.surface2, border: `1px dashed ${colors.borderStrong}` }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: colors.muted }}>
            Original values
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1, mt: 0.5 }}>
            {FIELDS.map((f) => (
              <Box key={f.key}>
                <Typography sx={{ fontSize: 11.5, color: colors.muted }}>{f.label}</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: colors.textDark }}>{f.fmt(doc.history[0].metadata)}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}
