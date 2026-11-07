import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { api } from '../api';
import type { EditStats, StatsFilter } from '../types';
import { colors } from '../theme';
import { rangeLabel } from '../utils/format';
import { annotatorLines, type Cell, dayLines, detailLines, downloadCsv, summaryLines, toCsv } from '../utils/editStats';

type Report = 'summary' | 'days' | 'annotators' | 'detail';

const REPORTS: { key: Report; label: string; hint: string }[] = [
  { key: 'summary', label: 'Summary', hint: 'Total images and % changed per field' },
  { key: 'days', label: 'By capture day', hint: 'Same numbers, one row per day' },
  { key: 'annotators', label: 'By annotator', hint: 'Images handled and fields changed per person' },
  { key: 'detail', label: 'Image-level detail', hint: 'Every image: original vs final values' },
];

const ALL = '';

interface Props {
  open: boolean;
  onClose: () => void;
  filter: StatsFilter;
  /** Already-loaded stats (annotator list for the select). */
  stats?: EditStats;
}

/** Pick reports → one CSV, sections separated by a blank line + title row. */
export default function ExportStatsDialog({ open, onClose, filter, stats }: Props) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<Report, boolean>>({
    summary: true,
    days: false,
    annotators: true,
    detail: false,
  });
  const [annotator, setAnnotator] = useState(ALL);
  const [changedOnly, setChangedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const anyPicked = Object.values(picked).some(Boolean);
  const toggle = (k: Report) => setPicked((p) => ({ ...p, [k]: !p[k] }));

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = picked.detail
        ? await qc.fetchQuery({ queryKey: ['edit-stats', filter, 'detail'], queryFn: () => api.getStats(filter, true) })
        : stats ?? (await api.getStats(filter));

      const people = annotator ? s.annotators.filter((a) => a.name === annotator) : s.annotators;
      const rows = (s.rows ?? [])
        .filter((r) => !annotator || r.editors.includes(annotator))
        .filter((r) => !changedOnly || r.changed.length > 0);

      const range = rangeLabel(filter.from, filter.to);
      const head: Cell[][] = [
        ['Edit stats', range],
        ['Client', filter.client || 'All clients'],
        ...(annotator ? [['Annotator', annotator]] : []),
        [],
      ];
      const sections: Cell[][][] = [];
      if (picked.summary) sections.push([['Summary'], ...summaryLines(s)]);
      if (picked.days) sections.push([['By capture day'], ...dayLines(s)]);
      if (picked.annotators) sections.push([['By annotator'], ...annotatorLines(people)]);
      if (picked.detail) sections.push([['Image-level detail'], ...detailLines(rows)]);

      const lines = [...head, ...sections.flatMap((sec, i) => (i ? [[], ...sec] : sec))];
      const tag = [filter.from ?? 'all', filter.to && filter.to !== filter.from ? filter.to : '', filter.client, annotator]
        .filter(Boolean)
        .join('_')
        .replace(/[^\w.-]+/g, '-');
      downloadCsv(`edit-stats_${tag}.csv`, toCsv(lines));
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>Export CSV</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: colors.muted, mb: 2 }}>
          {rangeLabel(filter.from, filter.to)} · {filter.client || 'All clients'}
        </Typography>

        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Include
        </Typography>
        <FormGroup sx={{ mb: 2 }}>
          {REPORTS.map((r) => (
            <FormControlLabel
              key={r.key}
              control={<Checkbox size="small" checked={picked[r.key]} onChange={() => toggle(r.key)} />}
              label={
                <Box sx={{ lineHeight: 1.3, py: 0.5 }}>
                  <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>{r.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: colors.muted, lineHeight: 1.3 }}>{r.hint}</Typography>
                </Box>
              }
            />
          ))}
        </FormGroup>

        <TextField
          select
          fullWidth
          size="small"
          label="Annotator"
          value={annotator}
          onChange={(e) => setAnnotator(e.target.value)}
          disabled={!picked.annotators && !picked.detail}
          helperText="Narrows the annotator and detail sections"
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value={ALL}>All annotators</MenuItem>
          {(stats?.annotators ?? []).map((a) => (
            <MenuItem key={a.name} value={a.name}>
              {a.name}
            </MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          sx={{ mt: 1 }}
          disabled={!picked.detail}
          control={<Switch size="small" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />}
          label="Detail: only images with a change"
        />

        {err && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {err}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="secondary" variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" startIcon={<DownloadIcon />} onClick={run} disabled={!anyPicked || busy}>
          {busy ? 'Preparing…' : 'Download'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
