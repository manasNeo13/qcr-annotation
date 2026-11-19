import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Badge,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Popover,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Close';
import TuneIcon from '@mui/icons-material/Tune';
import { api } from '../api';
import { useAccess } from '../auth/useAccess';
import type { ListState } from '../hooks/useListState';
import type { DayScope, StatusFilter } from '../types';
import { FILTERS } from '../utils/status';
import { colors } from '../theme';
import { NO_CLIENT, clientLabel } from '../utils/clients';
import DateRangeFilter from './DateRangeFilter';

const ALL = '';
const menuProps = { slotProps: { paper: { sx: { maxHeight: 360 } } } };
const selectSlots = { select: { MenuProps: menuProps, displayEmpty: true }, inputLabel: { shrink: true } };

interface Props {
  state: ListState;
  counts?: Record<StatusFilter, number>;
  searchPlaceholder: string;
  /** Client dropdown (NHQ only — others are locked to their own clients). */
  showScope?: boolean;
}

type ScopePatch = { client?: string | null };

/** Scope state + "jump to latest day" on change. Shared by inline + popover layouts. */
function useScope(state: ListState) {
  const { filter, update } = state;
  const qc = useQueryClient();
  const reqId = useRef(0);
  const { data } = useQuery({ queryKey: ['filter-options'], queryFn: api.getFilterOptions, staleTime: 5 * 60_000 });

  /** Apply change now, then move date to latest day with captures in new scope (keeps date if none). */
  const setScope = async (patch: ScopePatch) => {
    const id = ++reqId.current;
    const next = { client: filter.client ?? null, ...patch };
    update({ ...next, page: 1 });
    const today = dayjs().format('YYYY-MM-DD');
    const scope: DayScope = { client: next.client || undefined };
    try {
      const info = await qc.fetchQuery({
        queryKey: ['latest-day', scope],
        queryFn: () => api.getDays(today, today, scope),
        staleTime: 60_000,
      });
      if (id !== reqId.current || !info.latest) return; // newer change won / no data
      update({ ...next, from: info.latest, to: null, all: null, page: 1 });
    } catch {
      /* keep current date */
    }
  };

  const activeCount = filter.client ? 1 : 0;
  return { data, filter, setScope, activeCount };
}

/** Client select. inline = fixed width in toolbar row; stack = full width in popover. */
function ScopeFields({ scope, stack }: { scope: ReturnType<typeof useScope>; stack?: boolean }) {
  const { data, filter, setScope } = scope;
  // Keep current URL value selectable even before options load / if not in list.
  const withCurrent = (list: string[], cur?: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);
  const w = (n: number) => (stack ? { width: '100%' } : { width: n, flexShrink: 0 });

  return (
    <TextField
      select
      size="small"
      label="Client"
      value={filter.client ?? ALL}
      onChange={(e) => void setScope({ client: e.target.value })}
      sx={w(130)}
      slotProps={selectSlots}
    >
      <MenuItem value={ALL}>All clients</MenuItem>
      {withCurrent(data?.clients ?? [], filter.client === NO_CLIENT ? undefined : filter.client).map((c) => (
        <MenuItem key={c} value={c}>
          {clientLabel(c)}
        </MenuItem>
      ))}
      {(data?.noClient || filter.client === NO_CLIENT) && <MenuItem value={NO_CLIENT}>No client</MenuItem>}
    </TextField>
  );
}

/** Narrower screens: one "Filters" button → popover with the client select. */
function ScopeButton({ scope }: { scope: ReturnType<typeof useScope> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { activeCount, setScope } = scope;
  return (
    <>
      <Badge badgeContent={activeCount} color="primary" overlap="rectangular" sx={{ flexShrink: 0 }}>
        <Button
          variant="outlined"
          color={activeCount ? 'primary' : 'secondary'}
          startIcon={<TuneIcon />}
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="dialog"
          sx={{ height: 40, bgcolor: activeCount ? colors.brandSoft : '#fff', whiteSpace: 'nowrap' }}
        >
          Filters
        </Button>
      </Badge>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, p: 2, width: 300, maxWidth: 'calc(100vw - 24px)', borderRadius: '12px' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontWeight: 700, flex: 1 }}>Filters</Typography>
          {activeCount > 0 && (
            <Button size="small" onClick={() => void setScope({ client: null })}>
              Clear
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
          <ScopeFields scope={scope} stack />
        </Box>
      </Popover>
    </>
  );
}

/** Client filter — NHQ (super admin) only; renders nothing for everyone else. */
export function ScopeFilters({ state }: { state: ListState }) {
  const { me } = useAccess();
  if (!me?.superAdmin) return null;
  return <ScopeFiltersInner state={state} />;
}

function ScopeFiltersInner({ state }: { state: ListState }) {
  const scope = useScope(state);
  return (
    <>
      {/* Wide screens: inline in the row. */}
      <Box sx={{ display: { xs: 'none', xl: 'flex' }, gap: 1, flexShrink: 0 }}>
        <ScopeFields scope={scope} />
      </Box>
      {/* Otherwise: compact button. */}
      <Box sx={{ display: { xs: 'flex', xl: 'none' }, flexShrink: 0 }}>
        <ScopeButton scope={scope} />
      </Box>
    </>
  );
}

/**
 * Single-row toolbar: date · search · (filters) · status.
 * ≥ lg: one row. Smaller: status drops to its own scrollable line.
 */
export default function ListToolbar({ state, counts, searchPlaceholder, showScope = false }: Props) {
  const { filter, latest, search, setSearch, update, setRange } = state;
  const status = filter.status ?? 'all';
  const { me } = useAccess();
  const scopeOn = showScope && !!me?.superAdmin;

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexWrap: { xs: 'wrap', lg: 'nowrap' },
        alignItems: 'center',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', gap: 1, flex: '1 1 auto', minWidth: 0, width: { xs: '100%', lg: 'auto' } }}>
        <DateRangeFilter from={filter.from} to={filter.to} latest={latest} scope={state.scope} onChange={setRange} />
        <TextField
          size="small"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 120, maxWidth: scopeOn ? undefined : { lg: 460 } }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear search" onClick={() => setSearch('')}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            },
          }}
        />
        {scopeOn && <ScopeFilters state={state} />}
      </Box>
      <Box
        className="scrollbar-hide"
        sx={{
          overflowX: 'auto',
          flexShrink: 0,
          mx: { xs: -1.5, sm: 0 },
          ml: { xs: -1.5, sm: 0, lg: 'auto' },
          px: { xs: 1.5, sm: 0 },
          maxWidth: { xs: 'calc(100% + 24px)', sm: '100%' },
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v: StatusFilter | null) => v && update({ status: v, page: 1 })}
          aria-label="Filter by status"
          sx={{ flexWrap: 'nowrap' }}
        >
          {FILTERS.map((f) => (
            <ToggleButton key={f.value} value={f.value} sx={{ px: { xs: 1.25, xl: 1.5 }, whiteSpace: 'nowrap' }}>
              {f.label}
              <Box
                component="span"
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  px: 0.75,
                  borderRadius: '5px',
                  bgcolor: status === f.value ? '#fff' : colors.background,
                  minWidth: 22,
                  textAlign: 'center',
                }}
              >
                {counts?.[f.value] ?? '–'}
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
    </Box>
  );
}
