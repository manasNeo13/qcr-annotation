import { useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, ButtonBase, Divider, IconButton, Popover, Typography } from '@mui/material';
import CalendarIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '../api';
import { colors } from '../theme';
import { rangeLabel } from '../utils/format';

const F = 'YYYY-MM-DD';
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface Props {
  from?: string;
  to?: string;
  latest?: string | null;
  /** undefined from = all dates */
  onChange: (from?: string, to?: string) => void;
}

/** Monday-first 6-week grid for a month. */
function monthGrid(month: Dayjs) {
  const first = month.startOf('month');
  const start = first.subtract((first.day() + 6) % 7, 'day');
  return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
}

export default function DateRangeFilter({ from, to, latest, onChange }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [month, setMonth] = useState(() => dayjs(from ?? latest ?? undefined).startOf('month'));
  const [pendingStart, setPendingStart] = useState<string | null>(null); // first click of a range
  const [hover, setHover] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(month), [month]);
  const gridFrom = grid[0].format(F);
  const gridTo = grid[41].format(F);

  const { data } = useQuery({
    queryKey: ['days', gridFrom, gridTo],
    queryFn: () => api.getDays(gridFrom, gridTo),
    enabled: !!anchor,
    staleTime: 60_000,
  });
  const counts = useMemo(() => new Map(data?.days.map((d) => [d.date, d.count])), [data]);

  const open = (el: HTMLElement) => {
    setMonth(dayjs(from ?? latest ?? undefined).startOf('month'));
    setPendingStart(null);
    setAnchor(el);
  };
  const close = () => {
    setAnchor(null);
    setPendingStart(null);
    setHover(null);
  };
  const apply = (a?: string, b?: string) => {
    onChange(a, b);
    close();
  };

  // Click 1 → show that day (stay open). Click 2 → range [1, 2], close.
  const pick = (d: string) => {
    if (pendingStart && d !== pendingStart) {
      const [a, b] = d < pendingStart ? [d, pendingStart] : [pendingStart, d];
      apply(a, b);
      return;
    }
    if (pendingStart === d) return close();
    setPendingStart(d);
    onChange(d, d);
  };

  // Highlight: live range preview while choosing, else current selection.
  const selA = pendingStart ? (hover && hover < pendingStart ? hover : pendingStart) : from;
  const selB = pendingStart ? (hover && hover > pendingStart ? hover : pendingStart) : (to ?? from);

  const today = dayjs();
  const presets: { label: string; a?: string; b?: string }[] = [
    ...(latest ? [{ label: 'Latest day', a: latest, b: latest }] : []),
    { label: 'Today', a: today.format(F), b: today.format(F) },
    { label: 'Yesterday', a: today.subtract(1, 'day').format(F), b: today.subtract(1, 'day').format(F) },
    { label: 'Last 7 days', a: today.subtract(6, 'day').format(F), b: today.format(F) },
    { label: 'Last 30 days', a: today.subtract(29, 'day').format(F), b: today.format(F) },
    { label: 'This month', a: today.startOf('month').format(F), b: today.format(F) },
    { label: 'All dates' },
  ];
  const isActive = (p: { a?: string; b?: string }) =>
    (p.a ?? '') === (from ?? '') && (p.b ?? '') === (to ?? from ?? '');

  return (
    <>
      <Button
        variant="outlined"
        color="secondary"
        startIcon={<CalendarIcon />}
        onClick={(e) => open(e.currentTarget)}
        aria-haspopup="dialog"
        sx={{ height: 40, whiteSpace: 'nowrap', bgcolor: '#fff', flexShrink: 0 }}
      >
        {rangeLabel(from, to)}
      </Button>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, borderRadius: '12px', maxWidth: 'calc(100vw - 24px)' } } }}
      >
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' } }}>
          {/* Presets */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'row', sm: 'column' },
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
              gap: 0.5,
              p: 1.5,
              minWidth: { sm: 150 },
            }}
          >
            {presets.map((p) => (
              <Button
                key={p.label}
                size="small"
                onClick={() => apply(p.a, p.b)}
                sx={{
                  justifyContent: 'flex-start',
                  fontWeight: 600,
                  color: isActive(p) ? colors.primaryDark : colors.muted,
                  bgcolor: isActive(p) ? colors.brandSoft : 'transparent',
                }}
              >
                {p.label}
              </Button>
            ))}
          </Box>
          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

          {/* Calendar */}
          <Box sx={{ p: 1.5, width: 300, maxWidth: '100%' }} onMouseLeave={() => setHover(null)}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <IconButton
                size="small"
                aria-label="Previous month"
                onClick={() => setMonth((m) => m.subtract(1, 'month'))}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Typography sx={{ flex: 1, textAlign: 'center', fontWeight: 700 }}>
                {month.format('MMMM YYYY')}
              </Typography>
              <IconButton
                size="small"
                aria-label="Next month"
                disabled={month.isSame(today, 'month')}
                onClick={() => setMonth((m) => m.add(1, 'month'))}
              >
                <ChevronRightIcon />
              </IconButton>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.25 }}>
              {WEEKDAYS.map((w) => (
                <Typography
                  key={w}
                  sx={{ fontSize: 11.5, fontWeight: 700, color: colors.subtle, textAlign: 'center', py: 0.5 }}
                >
                  {w}
                </Typography>
              ))}
              {grid.map((d) => {
                const key = d.format(F);
                const n = counts.get(key) ?? 0;
                const inMonth = d.isSame(month, 'month');
                const future = d.isAfter(today, 'day');
                const edge = key === selA || key === selB;
                const inRange = !!selA && !!selB && key > selA && key < selB;
                return (
                  <ButtonBase
                    key={key}
                    disabled={future}
                    onClick={() => pick(key)}
                    onMouseEnter={() => pendingStart && setHover(key)}
                    title={n ? `${n} capture${n > 1 ? 's' : ''}` : 'No captures'}
                    aria-label={`${d.format('DD MMMM YYYY')}, ${n} captures`}
                    aria-pressed={edge || inRange}
                    sx={{
                      height: 38,
                      flexDirection: 'column',
                      borderRadius: edge ? '8px' : inRange ? 0 : '8px',
                      fontSize: 13.5,
                      fontWeight: edge ? 700 : 500,
                      color: edge ? '#fff' : future ? colors.subtle : inMonth ? colors.textDark : colors.subtle,
                      bgcolor: edge ? colors.primary : inRange ? colors.brandSoft : 'transparent',
                      opacity: inMonth ? 1 : 0.5,
                      '&:hover': { bgcolor: edge ? colors.primaryDark : colors.brandSoft },
                      outline: d.isSame(today, 'day') && !edge ? `1px solid ${colors.border}` : 'none',
                      outlineOffset: -1,
                    }}
                  >
                    {d.date()}
                    <Box
                      component="span"
                      sx={{
                        width: 5,
                        height: 5,
                        mt: '2px',
                        borderRadius: '50%',
                        bgcolor: n ? (edge ? '#fff' : colors.primary) : 'transparent',
                      }}
                    />
                  </ButtonBase>
                );
              })}
            </Box>
            <Typography sx={{ fontSize: 12, color: colors.muted, mt: 1, minHeight: 18 }}>
              {pendingStart ? 'Pick an end date for a range, or click again to close.' : 'Dots = days with captures.'}
            </Typography>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
