import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Paper } from '@mui/material';
import { api } from '../api';
import DocumentTable from '../components/DocumentTable';
import EmptyActions from '../components/EmptyActions';
import ListToolbar from '../components/ListToolbar';
import PageBreadcrumbs, { type Crumb } from '../components/PageBreadcrumbs';
import { carryParams, useListState } from '../hooks/useListState';

/** Fixed page size. */
const PAGE_SIZE = 15;

export default function DocumentsPage() {
  const navigate = useNavigate();
  const state = useListState();
  const { params, page, needDefaultDate, update } = state;
  // Edit-stats drill-down lives on the Stats page now → ignore stale ?changed/editor here.
  const filter = { ...state.filter, changed: undefined, editor: undefined };
  const query = { page, pageSize: PAGE_SIZE, ...filter };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['documents', 'list', query],
    queryFn: () => api.listDocuments(query),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });

  // Carry list filter so detail page can do prev/next + return to same list.
  const open = (id: string) => {
    const qs = carryParams(params, ['changed', 'editor', 'day']);
    if (page > 1) qs.set('page', String(page));
    navigate(`/documents/${encodeURIComponent(id)}?${qs}`);
  };

  const crumbs: Crumb[] = [{ label: 'Filter Table' }];

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={crumbs} />

      <Paper sx={{ overflow: 'hidden' }}>
        <ListToolbar
          state={state}
          counts={data?.counts}
          searchPlaceholder="Search EAN, batch no., capture ID…"
          showScope
        />
        <DocumentTable
          data={data}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          error={error}
          refetch={refetch}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={(p) => update({ page: p })}
          onOpen={open}
          emptyActions={<EmptyActions state={state} />}
        />
      </Paper>
    </Box>
  );
}
