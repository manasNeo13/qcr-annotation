import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Alert,
  Box,
  InputBase,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import KeyboardIcon from '@mui/icons-material/KeyboardOutlined';
import { api } from '../api';
import { ApiError } from '../api/client';
import { useLive } from '../live/LiveContext';
import { useAuth } from '../auth/AuthContext';
import { useAccess } from '../auth/useAccess';
import HistoryPanel from '../components/HistoryPanel';
import ImageViewer from '../components/ImageViewer';
import MetadataForm from '../components/MetadataForm';
import StatusChip from '../components/StatusChip';
import PageBreadcrumbs, { type Crumb } from '../components/PageBreadcrumbs';
import { readDay, readFilter, statsPath } from '../hooks/useListState';
import type { DocMetadata, DocumentItem } from '../types';
import { annotationPath, batchLabel, eanLabel } from '../utils/annotation';
import { formatDate, formatDateTime, formatMRP } from '../utils/format';
import type { MetadataFormValues } from '../utils/validation';
import { colors } from '../theme';

const FORM_ID = 'metadata-form';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: [string, string][] = [
  ['← / →', 'Previous / next capture'],
  ['E', 'Edit'],
  [`${MOD} + S`, 'Submit'],
  [`${MOD} + Enter`, 'Submit & next (next capture opens in edit mode)'],
  ['Esc', 'Cancel edit · back to list'],
  ['?', 'Show shortcuts'],
];

/** Same values/version/history → nothing new to show. */
const sameDoc = (a: DocumentItem, b: DocumentItem) =>
  JSON.stringify([a.metadata, a.version, a.history.length]) === JSON.stringify([b.metadata, b.version, b.history.length]);

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 1.25, columnGap: 2, m: 0 }}>
          {SHORTCUTS.map(([k, label]) => (
            <Box key={k} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ m: 0 }}>
                <Box
                  component="kbd"
                  sx={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: '6px',
                    border: `1px solid ${colors.borderStrong}`,
                    bgcolor: colors.surface2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {k}
                </Box>
              </Box>
              <Box component="dd" sx={{ m: 0, fontSize: 14, color: colors.textPrimary }}>
                {label}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: '8px',
        bgcolor: colors.surface2,
        border: `1px solid ${colors.border}`,
        minWidth: 0,
      }}
    >
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: colors.muted }}>{label}</Typography>
      <Typography
        sx={{
          fontSize: 17,
          fontWeight: 600,
          color: colors.textDark,
          wordBreak: 'break-word',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/**
 * "No. 501 / 2,000" — click and type a number to jump there.
 * No. 1 = oldest in the list → numbers don't move when new captures arrive on top.
 */
function JumpBox({ serial, total, onJump }: { serial: number | null; total: number; onJump: (n: number) => Promise<boolean> }) {
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = Number(typing);
    if (!Number.isInteger(n) || n < 1 || n > total) {
      toast.error(total ? `Enter a number from 1 to ${total.toLocaleString()}` : 'No captures in this list');
      return;
    }
    setBusy(true);
    const ok = await onJump(n);
    setBusy(false);
    if (ok) setTyping(null);
  };
  if (typing !== null) {
    return (
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}
      >
        <InputBase
          autoFocus
          value={typing}
          disabled={busy}
          onChange={(e) => setTyping(e.target.value.replace(/\D/g, '').slice(0, 9))}
          onBlur={() => !busy && setTyping(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTyping(null);
            }
          }}
          inputProps={{ inputMode: 'numeric', 'aria-label': 'Go to number' }}
          placeholder="No."
          sx={{
            width: 64,
            fontSize: 13,
            fontWeight: 600,
            '& input': { textAlign: 'center', p: '2px 4px', border: `1px solid ${colors.primary}`, borderRadius: '6px' },
          }}
        />
        <Typography sx={{ fontSize: 13, color: colors.muted, whiteSpace: 'nowrap' }}>/ {total.toLocaleString()}</Typography>
      </Box>
    );
  }
  return (
    <Tooltip title="Type a number to jump there">
      <Box
        component="button"
        type="button"
        disabled={!total}
        onClick={() => setTyping(serial ? String(serial) : '')}
        sx={{
          fontSize: 13,
          fontWeight: 600,
          color: colors.muted,
          px: 0.75,
          py: 0.5,
          minWidth: 64,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          bgcolor: 'transparent',
          border: 0,
          borderRadius: '6px',
          cursor: total ? 'text' : 'default',
          fontFamily: 'inherit',
          '&:hover': total ? { bgcolor: colors.brandSoft, color: colors.brandDark } : undefined,
        }}
      >
        {serial ? `No. ${serial.toLocaleString()} / ${total.toLocaleString()}` : total ? `– / ${total.toLocaleString()}` : '–'}
      </Box>
    </Tooltip>
  );
}

/** Remount per id → edit state resets on prev/next. */
export default function DocumentDetailPage() {
  const { id = '' } = useParams();
  return <DocumentDetail key={id} id={id} />;
}

function DocumentDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Came from Annotation drill-down → ean + batch in URL; prev/next stays inside that batch.
  const ean = params.get('ean') ?? undefined;
  const batch = params.get('batch') ?? undefined;
  const fromAnnotation = !!(ean && batch);
  // Edit Stats "By capture day" drill → that single day.
  const day = readDay(params);
  const base = readFilter(params);
  const filter = { ...base, ...(day && base.changed ? { from: day, to: day } : {}), ean, batch };
  const fromStats = !fromAnnotation && !!filter.changed;
  const listSearch = params.toString();
  // Back target = list this capture was opened from.
  const listParams = new URLSearchParams(params);
  listParams.delete('ean');
  listParams.delete('batch');
  const backTo = fromAnnotation
    ? annotationPath(ean, batch, listParams)
    : fromStats
      ? statsPath(params)
      : `/documents${listSearch ? `?${listSearch}` : ''}`;
  const upParams = new URLSearchParams(listParams);
  upParams.delete('page');
  upParams.delete('q');
  const crumbs: Crumb[] = fromAnnotation
    ? [
        { label: 'Annotation', to: annotationPath(undefined, undefined, upParams) },
        { label: `EAN ${eanLabel(ean!)}`, to: annotationPath(ean, undefined, upParams) },
        { label: `Batch ${batchLabel(batch!)}`, to: backTo },
        { label: 'Capture' },
      ]
    : fromStats
      ? [{ label: 'Edit Stats', to: backTo }, { label: 'Capture' }]
      : [{ label: 'Annotation Table', to: backTo }, { label: 'Capture' }];
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = useAccess();
  const canEditCaptures = can('edit_capture');
  // "Submit & next" opens the next capture already in edit mode.
  const navState = location.state as { edit?: boolean; full?: boolean } | null;
  const [editing, setEditing] = useState(() => !!navState?.edit);
  // Full-screen image stays open while stepping through captures.
  const [full, setFull] = useState(() => !!navState?.full);
  const fullRef = useRef(full);
  useEffect(() => {
    fullRef.current = full;
  }, [full]);
  // Unsaved values follow the form between page and full screen.
  const [draft, setDraft] = useState<MetadataFormValues | null>(null);
  const draftRef = useRef<MetadataFormValues | null>(null);
  const onDraftChange = useCallback((v: MetadataFormValues | null) => {
    draftRef.current = v;
  }, []);
  const toggleFull = useCallback((open: boolean) => {
    setDraft(draftRef.current); // remounted form restores it
    setFull(open);
  }, []);
  const [help, setHelp] = useState(false);
  const afterSave = useRef<'next' | null>(null);
  const [remote, setRemote] = useState<null | { kind: 'changed'; fresh: DocumentItem } | { kind: 'deleted' }>(null);
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const {
    data: doc,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id),
  });
  // New scan without a saved result → nothing to edit.
  const canEdit = canEditCaptures && !doc?.noResult;
  // "Submit & next" may land on such a scan → leave edit mode.
  useEffect(() => {
    if (doc?.noResult) setEditing(false);
  }, [doc?.noResult]);

  const mutation = useMutation({
    mutationFn: (m: DocMetadata) => api.updateDocument(id, m, user?.name || user?.email || 'unknown'),
    onSuccess: (updated: DocumentItem) => {
      qc.setQueryData(['document', id], updated);
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['edit-stats'] });
      setEditing(false);
      setDirty(false);
      setRemote(null);
      setDraft(null);
      draftRef.current = null;
      toast.success('Metadata updated');
      const next = navRef.current?.nextId;
      if (afterSave.current === 'next' && next) openCapture(next, true);
      afterSave.current = null;
    },
    onError: (e: Error) => {
      afterSave.current = null;
      toast.error(e.message || 'Update failed');
    },
  });

  // No placeholder: previous capture's prev/next must never drive this one (caused skips 2 → 4).
  const { data: nav } = useQuery({
    queryKey: ['neighbors', id, filter],
    queryFn: () => api.getNeighbors(id, filter),
  });

  // Warm next/prev capture + their neighbors so stepping feels instant.
  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    const f = JSON.parse(filterKey);
    for (const nid of [nav?.nextId, nav?.prevId]) {
      if (!nid) continue;
      qc.prefetchQuery({ queryKey: ['document', nid], queryFn: () => api.getDocument(nid) });
      qc.prefetchQuery({ queryKey: ['neighbors', nid, f], queryFn: () => api.getNeighbors(nid, f) });
    }
  }, [nav?.nextId, nav?.prevId, filterKey, qc]);

  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  /** Open another capture of this list (edit = straight into edit mode). */
  const openCapture = useCallback(
    (target: string, edit = false) =>
      navigate(`/documents/${encodeURIComponent(target)}${listSearch ? `?${listSearch}` : ''}`, {
        state: { edit, full: fullRef.current },
      }),
    [navigate, listSearch],
  );

  const go = useCallback(
    (target: string | null | undefined) => {
      if (!target) return;
      if (editing && dirty && !window.confirm('Discard unsaved changes?')) return;
      openCapture(target);
    },
    [editing, dirty, openCapture],
  );

  /** Submit form; next = then open next capture in edit mode. Nothing changed + next → just move on. */
  const submit = useCallback(
    (next: boolean) => {
      if (mutation.isPending || remote?.kind === 'deleted') return;
      if (!dirty) {
        if (next && nav?.nextId) openCapture(nav.nextId, true);
        return;
      }
      afterSave.current = next ? 'next' : null;
      (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit();
    },
    [dirty, mutation.isPending, remote?.kind, nav?.nextId, openCapture],
  );

  const back = useCallback(() => {
    if (editing && dirty && !window.confirm('Discard unsaved changes?')) return;
    navigate(backTo);
  }, [editing, dirty, navigate, backTo]);

  const cancel = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setEditing(false);
    setDirty(false);
    setDraft(null);
    draftRef.current = null;
  }, [dirty]);

  // Keyboard (see SHORTCUTS). Ctrl/⌘ combos + Esc also work inside inputs; plain keys don't (typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[role=dialog]') && !t.closest('[data-viewer-full]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (fullRef.current && e.key === 'Escape') return; // dialog closes itself, edits kept
      if (editing) {
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          submit(false);
        } else if (mod && e.key === 'Enter') {
          e.preventDefault();
          submit(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
        return;
      }
      if (e.altKey || mod) return;
      if (t.closest('input, textarea, select, [contenteditable=true]')) return;
      if (e.key === 'ArrowLeft') go(nav?.prevId);
      else if (e.key === 'ArrowRight') go(nav?.nextId);
      else if (e.key.toLowerCase() === 'e' && canEdit && doc && remote?.kind !== 'deleted') setEditing(true);
      else if (e.key === 'Escape') back();
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, go, nav?.prevId, nav?.nextId, submit, cancel, back, canEdit, doc, remote?.kind]);

  // Live: this capture edited/deleted elsewhere (SDK, main app, another user).
  const { subscribe } = useLive();
  const liveRef = useRef({ doc, editing, dirty, pending: mutation.isPending });
  useEffect(() => {
    liveRef.current = { doc, editing, dirty, pending: mutation.isPending };
  }, [doc, editing, dirty, mutation.isPending]);
  useEffect(
    () =>
      subscribe(async (s) => {
        if (s.kind !== 'changed' && !s.envs.includes(id)) return;
        try {
          const fresh = await api.getDocument(id);
          const cur = liveRef.current;
          if (!cur.doc || cur.pending || sameDoc(fresh, cur.doc)) return;
          if (cur.editing && cur.dirty) {
            setRemote({ kind: 'changed', fresh }); // don't wipe unsaved edits — ask
          } else {
            qc.setQueryData(['document', id], fresh);
            toast('This capture was just updated elsewhere', { icon: '🔄' });
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            setRemote({ kind: 'deleted' });
            setEditing(false);
          }
        }
      }),
    [subscribe, id, qc],
  );
  const loadLatest = () => {
    if (remote?.kind !== 'changed') return;
    qc.setQueryData(['document', id], remote.fresh);
    setDirty(false);
    setDraft(null);
    draftRef.current = null;
    setRemote(null);
  };

  const navBox = (
    <Box
      role="navigation"
      aria-label="Capture navigation"
      sx={{
        display: 'flex',
        alignItems: 'center',
        bgcolor: '#fff',
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        height: 40,
      }}
    >
      <Tooltip title="Previous (←)">
        <span>
          <IconButton
            size="small"
            aria-label="Previous capture"
            disabled={!nav?.prevId}
            onClick={() => go(nav?.prevId)}
          >
            <ChevronLeftIcon />
          </IconButton>
        </span>
      </Tooltip>
      <JumpBox
        serial={nav && nav.index >= 0 ? nav.total - nav.index : null}
        total={nav?.total ?? 0}
        onJump={async (n) => {
          try {
            const { id: target } = await api.idAt(n, filter);
            if (target !== id) go(target);
            return true;
          } catch (e) {
            toast.error((e as Error).message || 'Could not open that number');
            return false;
          }
        }}
      />
      <Tooltip title="Next (→)">
        <span>
          <IconButton
            size="small"
            aria-label="Next capture"
            disabled={!nav?.nextId}
            onClick={() => go(nav?.nextId)}
          >
            <ChevronRightIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
  const actions = (
    <Box sx={{ display: 'flex', gap: 1 }}>
      {editing ? (
        <>
          <Button variant="outlined" color="secondary" onClick={cancel} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Tooltip title={`Submit (${MOD}+S)`}>
            <span>
              <Button
                variant={nav?.nextId ? 'outlined' : 'contained'}
                onClick={() => submit(false)}
                disabled={mutation.isPending || !dirty || remote?.kind === 'deleted'}
                startIcon={mutation.isPending && !afterSave.current ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
                sx={{ '& .MuiButton-startIcon': { display: { xs: 'none', sm: 'inherit' } } }}
              >
                Submit
              </Button>
            </span>
          </Tooltip>
          {nav?.nextId && (
            <Tooltip title={dirty ? `Submit, then open next capture (${MOD}+Enter)` : `No changes — open next capture (${MOD}+Enter)`}>
              <span>
                <Button
                  variant="contained"
                  onClick={() => submit(true)}
                  disabled={mutation.isPending || remote?.kind === 'deleted'}
                  endIcon={
                    mutation.isPending && afterSave.current ? <CircularProgress size={16} color="inherit" /> : <ArrowForwardIcon />
                  }
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {dirty ? 'Submit & next' : 'Next'}
                </Button>
              </span>
            </Tooltip>
          )}
        </>
      ) : canEdit ? (
        <Tooltip title="Edit (E)">
          <span>
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => setEditing(true)}
              disabled={!doc || remote?.kind === 'deleted'}
            >
              Edit
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </Box>
  );
  /** Edit form (one instance at a time: side panel, or full-screen bar). */
  const form = (compact: boolean) =>
    doc && (
      <MetadataForm
        key={`${doc.version}|${JSON.stringify(doc.metadata)}`}
        formId={FORM_ID}
        initial={doc.metadata}
        disabled={mutation.isPending}
        onSubmit={(m) => mutation.mutate(m)}
        onDirtyChange={onDirtyChange}
        compact={compact}
        draft={draft}
        onDraftChange={onDraftChange}
      />
    );
  /** Full-screen bar under the image: values / edit form + prev/next + edit/submit buttons. */
  const fullBar = doc && (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2" noWrap>
            {editing ? 'Edit metadata' : 'Metadata'}
          </Typography>
          <StatusChip status={doc.status} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {navBox}
          {actions}
        </Box>
      </Box>
      {editing ? (
        form(true)
      ) : doc.noResult ? (
        <Alert severity="info">No result saved for this scan yet, so there are no values to show or edit.</Alert>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
          <Field label="Manufacturing date" value={formatDate(doc.metadata.mfgDate)} />
          <Field label="Expiry date" value={formatDate(doc.metadata.expiryDate)} />
          <Field label="Batch number" value={doc.metadata.batchNumber || '—'} mono />
          <Field label="MRP" value={formatMRP(doc.metadata.mrp)} />
        </Box>
      )}
    </Box>
  );

  if (isError) {
    return (
      <Box sx={{ maxWidth: 640, mx: 'auto', mt: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {(error as Error)?.message || 'Could not load document.'}
        </Alert>
        <Button component={RouterLink} to={backTo} startIcon={<ArrowBackIcon />} sx={{ mt: 2 }}>
          Back to list
        </Button>
      </Box>
    );
  }

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={crumbs} />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
      {remote?.kind === 'changed' && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button color="inherit" size="small" onClick={loadLatest}>
                Load latest
              </Button>
              <Button color="inherit" size="small" onClick={() => setRemote(null)}>
                Keep mine
              </Button>
            </Box>
          }
        >
          This capture was changed elsewhere while you were editing. Load the latest values (your edits are discarded) or keep
          editing.
        </Alert>
      )}
      {remote?.kind === 'deleted' && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate(backTo)}>
              Back to list
            </Button>
          }
        >
          This capture was deleted. It can't be edited any more.
        </Alert>
      )}
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
          gap: { xs: 1, sm: 1.5 },
          mb: { xs: 2, sm: 3 },
        }}
      >
        <Tooltip title="Back">
          <IconButton
            onClick={back}
            aria-label="Back to list"
            sx={{
              mt: { xs: 0, sm: 0.25 },
              bgcolor: '#fff',
              border: `1px solid ${colors.border}`,
            }}
          >
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {doc ? (
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                }}
              >
                <Typography
                  variant="h3"
                  component="h1"
                  sx={{
                    fontSize: { xs: '1.2rem', sm: '1.5rem' },
                    lineHeight: 1.25,
                  }}
                >
                  {doc.productName}
                </Typography>
                <StatusChip status={doc.status} size="medium" />
              </Box>
            </>
          ) : (
            <>
              <Skeleton width="min(320px, 70%)" height={36} />
              <Skeleton width={180} />
            </>
          )}
        </Box>

        {/* Top-right actions */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexShrink: 0,
            width: { xs: '100%', sm: 'auto' },
            justifyContent: { xs: 'space-between', sm: 'flex-end' },
          }}
        >
          <Tooltip title="Keyboard shortcuts (?)">
            <IconButton
              onClick={() => setHelp(true)}
              aria-label="Keyboard shortcuts"
              sx={{ display: { xs: 'none', md: 'inline-flex' }, bgcolor: '#fff', border: `1px solid ${colors.border}` }}
            >
              <KeyboardIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {navBox}
          {actions}
        </Box>
      </Box>

      {/* Body */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0,1fr)',
            md: 'minmax(0,1.25fr) minmax(0,1fr)',
          },
          gap: { xs: 2, sm: 3 },
          alignItems: 'start',
        }}
      >
        <Box sx={{ position: { md: 'sticky' }, top: { md: 92 } }}>
          {doc ? (
            <ImageViewer
              key={doc.id}
              src={doc.imageUrl}
              alt={doc.productName}
              images={doc.images}
              full={full}
              onFullChange={toggleFull}
              fullFooter={fullBar}
            />
          ) : (
            <Skeleton variant="rounded" sx={{ width: '100%', aspectRatio: '4 / 3', height: 'auto' }} />
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: 2, sm: 3 },
            minWidth: 0,
          }}
        >
          <Paper
            sx={{
              p: { xs: 2, sm: 3 },
              outline: editing ? `2px solid ${colors.primary}` : 'none',
              transition: 'outline .2s',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 1,
                mb: 2,
                flexWrap: 'wrap',
              }}
            >
              <Typography variant="h5" component="h2">
                {editing ? 'Edit metadata' : 'Metadata'}
              </Typography>
              {doc && (
                <Typography sx={{ fontSize: 12, color: colors.muted }}>
                  v{doc.version} · {doc.version > 1 ? `edited by ${doc.updatedBy} · ` : ''}
                  {formatDateTime(doc.updatedAt)}
                </Typography>
              )}
            </Box>

            {isLoading || !doc ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1.5,
                }}
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} variant="rounded" height={68} />
                ))}
              </Box>
            ) : editing ? (
              full ? (
                <Typography sx={{ fontSize: 13, color: colors.muted }}>Editing in full screen.</Typography>
              ) : (
                form(false)
              )
            ) : doc.noResult ? (
              <Alert severity="info">No result saved for this scan yet, so there are no values to show or edit.</Alert>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: { xs: 1, sm: 1.5 },
                }}
              >
                <Field label="Manufacturing date" value={formatDate(doc.metadata.mfgDate)} />
                <Field label="Expiry date" value={formatDate(doc.metadata.expiryDate)} />
                <Field label="Batch number" value={doc.metadata.batchNumber} mono />
                <Field label="MRP" value={formatMRP(doc.metadata.mrp)} />
              </Box>
            )}
          </Paper>

          {doc && <HistoryPanel doc={doc} />}
        </Box>
      </Box>
    </Box>
  );
}
