import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Paper } from '@mui/material';
import { api } from '../api';
import DocumentTable from '../components/DocumentTable';
import EmptyActions from '../components/EmptyActions';
import GroupTable from '../components/GroupTable';
import ListToolbar from '../components/ListToolbar';
import PageBreadcrumbs, { type Crumb } from '../components/PageBreadcrumbs';
import { carryParams, useListState } from '../hooks/useListState';
import { annotationPath, batchLabel, eanLabel } from '../utils/annotation';

const PAGE_SIZE = 15;

/**
 * Annotation drill-down (one page, 3 levels):
 *   /annotation              → EAN list
 *   /annotation/:ean         → batches inside EAN
 *   /annotation/:ean/:batch  → captures of that batch (click → detail/edit)
 * Date / status / scope filters carry through levels; search + page reset per level.
 */
export default function AnnotationPage() {
  const { ean, batch } = useParams();
  // Remount per level → search box + debounce state reset.
  return <AnnotationLevel key={`${ean ?? ''}|${batch ?? ''}`} ean={ean} batch={batch} />;
}

function AnnotationLevel({ ean, batch }: { ean?: string; batch?: string }) {
  const navigate = useNavigate();
  const state = useListState({ scoped: false });
  const { params, filter, page, needDefaultDate, update } = state;
  const level: 'ean' | 'batch' | 'docs' = !ean ? 'ean' : !batch ? 'batch' : 'docs';
  const query = { page, pageSize: PAGE_SIZE, ...filter, ean, batch };

  const groups = useQuery({
    queryKey: ['groups', level, query],
    queryFn: () => api.listGroups(level === 'ean' ? 'ean' : 'batch', query),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate && level !== 'docs',
  });
  const docs = useQuery({
    queryKey: ['documents', query],
    queryFn: () => api.listDocuments(query),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate && level === 'docs',
  });

  // Next level keeps date/status/scope, drops search + page.
  const down = carryParams(params, ['q', 'client']); // also used by breadcrumb links to upper levels
  const crumbs: Crumb[] = [{ label: 'Annotation', to: annotationPath(undefined, undefined, down) }];
  if (ean) crumbs.push({ label: `EAN ${eanLabel(ean)}`, to: annotationPath(ean, undefined, down) });
  if (ean && batch) crumbs.push({ label: `Batch ${batchLabel(batch)}` });

  const openDoc = (id: string) => {
    const qs = carryParams(params, ['client'], { ean: ean!, batch: batch! });
    if (page > 1) qs.set('page', String(page));
    navigate(`/documents/${encodeURIComponent(id)}?${qs}`);
  };

  const counts = level === 'docs' ? docs.data?.counts : groups.data?.counts;
  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={crumbs} />

      <Paper sx={{ overflow: 'hidden' }}>
        <ListToolbar
          state={state}
          counts={counts}
          searchPlaceholder={
            level === 'ean' ? 'Search EAN, batch no.…' : level === 'batch' ? 'Search batch no.…' : 'Search capture ID…'
          }
        />
        {level === 'docs' ? (
          <DocumentTable
            data={docs.data}
            isLoading={docs.isLoading}
            isFetching={docs.isFetching}
            isError={docs.isError}
            error={docs.error}
            refetch={docs.refetch}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={(p) => update({ page: p })}
            onOpen={openDoc}
            emptyActions={<EmptyActions state={state} />}
          />
        ) : (
          <GroupTable
            by={level === 'ean' ? 'ean' : 'batch'}
            data={groups.data}
            isLoading={groups.isLoading}
            isFetching={groups.isFetching}
            isError={groups.isError}
            error={groups.error}
            refetch={groups.refetch}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={(p) => update({ page: p })}
            onOpen={(key) => navigate(level === 'ean' ? annotationPath(key, undefined, down) : annotationPath(ean, key, down))}
            label={level === 'ean' ? eanLabel : batchLabel}
            emptyActions={<EmptyActions state={state} />}
          />
        )}
      </Paper>
    </Box>
  );
}
