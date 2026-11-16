import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Skeleton, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '../api';
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
import { NEAR_EXPIRY_PCT } from '../utils/status';
import { colors } from '../theme';

const FORM_ID = 'metadata-form';

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

/** Remount per id → edit state resets on prev/next. */
export default function DocumentDetailPage() {
  const { id = '' } = useParams();
  return <DocumentDetail key={id} id={id} />;
}

function DocumentDetail({ id }: { id: string }) {
  const navigate = useNavigate();
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
      : [{ label: 'Filter Table', to: backTo }, { label: 'Capture' }];
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = useAccess();
  const canEdit = can('edit_capture');
  const [editing, setEditing] = useState(false);
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

  const mutation = useMutation({
    mutationFn: (m: DocMetadata) => api.updateDocument(id, m, user?.name || user?.email || 'unknown'),
    onSuccess: (updated: DocumentItem) => {
      qc.setQueryData(['document', id], updated);
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['edit-stats'] });
      setEditing(false);
      setDirty(false);
      toast.success('Metadata updated');
    },
    onError: (e: Error) => toast.error(e.message || 'Update failed'),
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

  const go = useCallback(
    (target: string | null | undefined) => {
      if (!target) return;
      if (editing && dirty && !window.confirm('Discard unsaved changes?')) return;
      navigate(`/documents/${encodeURIComponent(target)}${listSearch ? `?${listSearch}` : ''}`);
    },
    [editing, dirty, navigate, listSearch],
  );

  // ← / → keys step through captures (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return;
      if (e.key === 'ArrowLeft') go(nav?.prevId);
      if (e.key === 'ArrowRight') go(nav?.nextId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, go, nav?.prevId, nav?.nextId]);

  const back = () => {
    if (editing && dirty && !window.confirm('Discard unsaved changes?')) return;
    navigate(backTo);
  };

  const cancel = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setEditing(false);
    setDirty(false);
  };

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
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.muted,
                px: 0.5,
                minWidth: 64,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {nav && nav.index >= 0 ? `${(nav.index + 1).toLocaleString()} / ${nav.total.toLocaleString()}` : '–'}
            </Typography>
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
          <Box sx={{ display: 'flex', gap: 1 }}>
            {editing ? (
              <>
                <Button variant="outlined" color="secondary" onClick={cancel} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form={FORM_ID}
                  variant="contained"
                  disabled={mutation.isPending || !dirty}
                  startIcon={mutation.isPending ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
                  sx={{
                    '& .MuiButton-startIcon': {
                      display: { xs: 'none', sm: 'inherit' },
                    },
                  }}
                >
                  Submit
                </Button>
              </>
            ) : canEdit ? (
              <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)} disabled={!doc}>
                Edit
              </Button>
            ) : null}
          </Box>
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
            <ImageViewer key={doc.id} src={doc.imageUrl} alt={doc.productName} />
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
              <>
                <MetadataForm
                  formId={FORM_ID}
                  initial={doc.metadata}
                  disabled={mutation.isPending}
                  onSubmit={(m) => mutation.mutate(m)}
                  onDirtyChange={onDirtyChange}
                />
                <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
                  Current values are kept in edit history. Status updates from the dates (near expiry = under{' '}
                  {NEAR_EXPIRY_PCT}% shelf life left).
                </Typography>
              </>
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
