import { useEffect, useRef, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { colors } from '../theme';
import { NONE_KEY } from '../types';
import { useLive, type LiveEvent } from './LiveContext';

const IST_MS = 5.5 * 3600_000;
const istDay = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);

export interface LiveView {
  from?: string;
  to?: string;
  q?: string;
  ean?: string;
  batch?: string;
}

/** Would this capture show up in the current list? (date range, search, EAN/batch drill-down; status unknown → counted) */
// eslint-disable-next-line react-refresh/only-export-components -- tiny helper, kept beside the pill
export function matchesView(e: LiveEvent, v: LiveView) {
  if (v.from) {
    const d = istDay(e.ts);
    if (d < v.from || d > (v.to ?? v.from)) return false;
  }
  const same = (val: string, want?: string) => !want || (want === NONE_KEY ? !val : val === want);
  if (!same(e.ean, v.ean) || !same(e.batch, v.batch)) return false;
  const q = v.q?.trim().toLowerCase();
  return !q || [e.ean, e.batch, e.env].some((s) => s.toLowerCase().includes(q));
}

const dot = (color: string, pulse = false) => (
  <Box
    component="span"
    className={pulse ? 'nq-live-dot' : undefined}
    sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0, color }}
  />
);

const pillSx = {
  height: 28,
  px: 1.25,
  gap: 0.75,
  borderRadius: '999px',
  fontSize: 12.5,
  fontWeight: 700,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flexShrink: 0,
} as const;

const ADDED_MS = 3_000;

/**
 * Status pill next to the breadcrumbs. New captures reload the list by themselves (any page).
 *   ● Live                  — connected, nothing new
 *   ● 2 new captures added  — list just reloaded, new rows glow; back to Live after 3s
 *   ● Connecting… / Offline — connection lost, retrying
 */
export default function LivePill({ view, onRefresh }: { view: LiveView; onRefresh: (events: LiveEvent[]) => void }) {
  const { status, pending, dismiss } = useLive();
  const mine = pending.filter((e) => matchesView(e, view));
  const mineKey = mine.map((e) => e.env).join('|');

  const [added, setAdded] = useState(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const addedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!mine.length) return;
    refreshRef.current(mine);
    dismiss(mine.map((e) => e.env));
    setAdded((n) => n + mine.length);
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(0), ADDED_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineKey]);
  useEffect(() => () => clearTimeout(addedTimer.current), []);

  if (added > 0) {
    return (
      <Box
        role="status"
        aria-live="polite"
        className="nq-pill-in"
        sx={{
          ...pillSx,
          display: 'inline-flex',
          alignItems: 'center',
          color: colors.brandDark,
          bgcolor: colors.brandSoft,
          border: `1px solid ${colors.brand100}`,
        }}
      >
        {dot(colors.primary, true)}
        {added > 99 ? '99+' : added} new capture{added === 1 ? '' : 's'} added
      </Box>
    );
  }

  const live = status === 'live';
  const tip =
    status === 'live'
      ? '' // no tooltip while live
      : status === 'connecting'
          ? 'Connecting to live updates…'
          : 'Live updates unavailable — refresh the page to retry';
  return (
    <Tooltip title={tip}>
      <Box
        role="status"
        sx={{
          ...pillSx,
          display: 'inline-flex',
          alignItems: 'center',
          border: `1px solid ${colors.border}`,
          bgcolor: '#fff',
          color: live ? colors.brandDark : colors.muted,
        }}
      >
        {live ? dot(colors.primary, true) : dot(status === 'offline' ? colors.subtle : '#f4a100')}
        {live ? 'Live' : status === 'offline' ? 'Offline' : 'Connecting…'}
      </Box>
    </Tooltip>
  );
}
