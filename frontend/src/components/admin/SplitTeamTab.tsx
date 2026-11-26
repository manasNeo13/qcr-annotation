import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import RemoveIcon from '@mui/icons-material/PersonRemoveOutlined';
import SwapIcon from '@mui/icons-material/SwapHoriz';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import { adminApi } from '../../api/admin';
import { colors } from '../../theme';
import type { SplitDivideResult, SplitMember, SplitOverview } from '../../types';
import { formatDateTime } from '../../utils/format';
import { ActiveChip } from './common';
import { ADMIN_KEYS } from './keys';

type Person = SplitOverview['candidates'][number];

/** Move one member's captures (by assigned day range) to another person — e.g. someone is absent. */
function MoveDialog({ data, from, onClose }: { data: SplitOverview; from: SplitMember; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<Person | null>(null);
  const [fromDay, setFromDay] = useState(data.today);
  const [toDay, setToDay] = useState(data.today);
  const people: Person[] = [...data.members.filter((m) => m.id !== from.id && m.active), ...data.candidates];
  const move = useMutation({
    mutationFn: () => adminApi.moveSplit({ from: from.id, to: to!.id, fromDay, toDay }),
    onSuccess: (r) => {
      qc.setQueryData(ADMIN_KEYS.split, r);
      qc.invalidateQueries({ queryKey: ADMIN_KEYS.audit });
      toast.success(r.moved ? `Moved ${r.moved} capture${r.moved === 1 ? '' : 's'}` : 'Nothing to move in those days');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not move captures'),
  });
  const badRange = !fromDay || !toDay || fromDay > toDay;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Move {from.name}'s captures</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontSize: 13.5, color: colors.muted }}>
          Captures of these days go to another person. Not on the team yet → they join it.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label="From day"
            type="date"
            size="small"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            label="To day"
            type="date"
            size="small"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            error={!!fromDay && !!toDay && fromDay > toDay}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Box>
        <Autocomplete
          options={people}
          value={to}
          onChange={(_, v) => setTo(v)}
          getOptionLabel={(p) => p.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          groupBy={(p) => (data.members.some((m) => m.id === p.id) ? 'Team' : 'Add to team')}
          renderOption={(props, p) => (
            <li {...props} key={p.id}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{p.name}</Typography>
                <Typography sx={{ fontSize: 12, color: colors.muted }}>{p.email || p.id}</Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Give to" size="small" />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!to || badRange || move.isPending} onClick={() => move.mutate()}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Divide captures of chosen past days (nobody's yet) among the team. Preview first, then confirm. */
function DivideDialog({ data, onClose }: { data: SplitOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const [fromDay, setFromDay] = useState(data.today);
  const [toDay, setToDay] = useState(data.today);
  const [preview, setPreview] = useState<SplitDivideResult | null>(null);
  const name = (id: string) => data.members.find((m) => m.id === id)?.name ?? id;
  const run = useMutation({
    mutationFn: (dry: boolean) => adminApi.divideSplit({ fromDay, toDay, dry }),
    onSuccess: (r) => {
      if (!r.done) return setPreview(r);
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(`Divided ${r.captures} capture${r.captures === 1 ? '' : 's'}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not divide'),
  });
  const badRange = !fromDay || !toDay || fromDay > toDay;
  const setDay = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    f(e.target.value);
    setPreview(null);
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Divide past days</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography sx={{ fontSize: 13.5, color: colors.muted }}>
          Captures of these days that nobody has yet get shared out equally, per day. After this, each person sees only their own
          from those days.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField label="From day" type="date" size="small" value={fromDay} onChange={setDay(setFromDay)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
          <TextField
            label="To day"
            type="date"
            size="small"
            value={toDay}
            onChange={setDay(setToDay)}
            error={!!fromDay && !!toDay && fromDay > toDay}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Box>
        {preview && (
          <Alert severity={preview.captures ? 'info' : 'warning'} icon={false}>
            {preview.captures ? (
              <>
                <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>
                  {preview.captures} capture{preview.captures === 1 ? '' : 's'} over {preview.days.length} day
                  {preview.days.length === 1 ? '' : 's'}
                </Typography>
                {preview.perMember.map((p) => (
                  <Typography key={p.id} sx={{ fontSize: 13 }}>
                    {name(p.id)}: <b>{p.captures}</b>
                  </Typography>
                ))}
              </>
            ) : (
              'Nothing to divide — no unassigned captures on those days.'
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {preview?.captures ? (
          <Button variant="contained" disabled={run.isPending} onClick={() => run.mutate(false)}>
            Divide {preview.captures}
          </Button>
        ) : (
          <Button variant="contained" disabled={badRange || run.isPending} onClick={() => run.mutate(true)}>
            Preview
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Add people to the team. */
function AddDialog({ data, onClose }: { data: SplitOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Person[]>([]);
  const save = useMutation({
    mutationFn: () => adminApi.setSplitTeam([...data.members.map((m) => m.id), ...picked.map((p) => p.id)]),
    onSuccess: (r) => {
      qc.setQueryData(ADMIN_KEYS.split, r);
      qc.invalidateQueries({ queryKey: ADMIN_KEYS.audit });
      toast.success(`Added ${picked.length} to the team`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not add'),
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add to split team</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Autocomplete
          multiple
          options={data.candidates}
          value={picked}
          onChange={(_, v) => setPicked(v)}
          getOptionLabel={(p) => p.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterSelectedOptions
          renderOption={(props, p) => (
            <li {...props} key={p.id}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{p.name}</Typography>
                <Typography sx={{ fontSize: 12, color: colors.muted }}>{p.email || p.id}</Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="People" placeholder="Search name" />}
        />
        <Typography sx={{ mt: 1.5, fontSize: 13, color: colors.muted }}>
          They start getting new captures right away. Old captures stay visible to all of them.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!picked.length || save.isPending} onClick={() => save.mutate()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Split team (NHQ): members, today's / total captures, add people, move captures, remove (only when empty).
 * New captures are divided equally per day among active members; old captures are shared.
 */
export default function SplitTeamTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ADMIN_KEYS.split,
    queryFn: adminApi.split,
    refetchInterval: 30_000,
  });
  const [adding, setAdding] = useState(false);
  const [dividing, setDividing] = useState(false);
  const [moving, setMoving] = useState<SplitMember | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.setSplitTeam(data!.members.filter((m) => m.id !== id).map((m) => m.id)),
    onSuccess: (r) => {
      qc.setQueryData(ADMIN_KEYS.split, r);
      qc.invalidateQueries({ queryKey: ADMIN_KEYS.audit });
      toast.success('Removed from team');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not remove'),
  });

  if (isError) {
    return (
      <Alert
        severity="error"
        sx={{ m: 2 }}
        action={
          <Button color="inherit" size="small" onClick={() => refetch()}>
            Retry
          </Button>
        }
      >
        {(error as Error)?.message || 'Could not load split team.'}
      </Alert>
    );
  }

  const todayTotal = data?.members.reduce((n, m) => n + m.today, 0) ?? 0;

  return (
    <>
      <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderBottom: `1px solid ${colors.border}` }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography sx={{ fontWeight: 700, color: colors.textDark }}>Work split</Typography>
          <Typography sx={{ fontSize: 13, color: colors.muted }}>
            {data?.startedAt
              ? `New captures since ${formatDateTime(data.startedAt)} are shared out equally each day. Older ones: everyone on the team sees them, unless you divide those days.`
              : 'Add people to start. From then on, new captures are shared out equally each day.'}
          </Typography>
        </Box>
        {!!data?.members.length && (
          <Chip label={`Today: ${todayTotal} capture${todayTotal === 1 ? '' : 's'}`} sx={{ fontWeight: 600, bgcolor: colors.brandSoft, color: colors.brandDark }} />
        )}
        <Button variant="outlined" startIcon={<CallSplitIcon />} disabled={!data?.members.some((m) => m.active)} onClick={() => setDividing(true)}>
          Divide past days
        </Button>
        <Button variant="contained" startIcon={<PersonAddIcon />} disabled={!data} onClick={() => setAdding(true)}>
          Add people
        </Button>
      </Box>

      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Today</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell width={96} />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton height={32} />
                  </TableCell>
                </TableRow>
              ))
            ) : !data?.members.length ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 6, textAlign: 'center', color: colors.muted }}>
                  No one on the split team yet.
                </TableCell>
              </TableRow>
            ) : (
              data.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600, fontSize: 14, color: colors.textDark }}>{m.name}</Typography>
                    <Typography sx={{ fontSize: 12, color: colors.muted }}>{m.email || m.id}</Typography>
                  </TableCell>
                  <TableCell>
                    <ActiveChip active={m.active} />
                    {!m.active && (
                      <Typography sx={{ fontSize: 11.5, color: colors.muted, mt: 0.25 }}>Gets no new captures</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{m.today}</TableCell>
                  <TableCell align="right">{m.total}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: colors.muted, fontSize: 13 }}>{formatDateTime(m.joinedAt ?? undefined)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Move captures to someone else">
                      <IconButton size="small" aria-label={`Move ${m.name}'s captures`} onClick={() => setMoving(m)}>
                        <SwapIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={m.total ? 'Move their captures first' : 'Remove from team'}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Remove ${m.name}`}
                          disabled={m.total > 0 || remove.isPending}
                          onClick={() => remove.mutate(m.id)}
                        >
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {dividing && data && <DivideDialog data={data} onClose={() => setDividing(false)} />}
      {adding && data && <AddDialog data={data} onClose={() => setAdding(false)} />}
      {moving && data && <MoveDialog data={data} from={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

