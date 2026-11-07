import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Box, Chip, Paper, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/EditNoteOutlined';
import { api } from '../api';
import DocumentTable from '../components/DocumentTable';
import EmptyActions from '../components/EmptyActions';
import ListToolbar from '../components/ListToolbar';
import PageBreadcrumbs, { type Crumb } from '../components/PageBreadcrumbs';
import { carryParams, statsPath, useListState } from '../hooks/useListState';
import { colors } from '../theme';
import { editLabel } from '../utils/editStats';

/** Fixed page size. */
const PAGE_SIZE = 15;

export default function DocumentsPage() {
  const navigate = useNavigate();
  const state = useListState();
  const { params, filter, page, needDefaultDate, update } = state;
  // ?changed=… → Edit Stats drill-down (images where that field was edited, optionally by editor).
  const edited = !!filter.changed;
  const query = { page, pageSize: PAGE_SIZE, ...filter };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['documents', edited ? 'edited' : 'list', query],
    queryFn: () => (edited ? api.listEdited(query) : api.listDocuments(query)),
    placeholderData: keepPreviousData,
    enabled: !needDefaultDate,
  });

  // Carry list filter so detail page can do prev/next + return to same list.
  const open = (id: string) => {
    const qs = carryParams(params);
    if (page > 1) qs.set('page', String(page));
    navigate(`/documents/${encodeURIComponent(id)}?${qs}`);
  };

  const crumbs: Crumb[] = edited
    ? [{ label: 'Edit Stats', to: statsPath(params) }, { label: 'Filter Table' }]
    : [{ label: 'Filter Table' }];

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={crumbs} />

      <Paper sx={{ overflow: 'hidden' }}>
        {edited && (
          <Box
            sx={{
              px: { xs: 1.5, sm: 2 },
              pt: { xs: 1.5, sm: 2 },
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Chip
              icon={<EditIcon />}
              label={editLabel(filter.changed!, filter.editor)}
              color="primary"
              variant="outlined"
              onDelete={() => update({ changed: null, editor: null, page: 1 })}
              sx={{ fontWeight: 600, bgcolor: colors.brandSoft }}
            />
            <Typography sx={{ fontSize: 12.5, color: colors.muted }}>
              {filter.editor ? 'Images where this annotator changed the field' : 'Images where final value ≠ original OCR'}
              {' · capture day'}
            </Typography>
          </Box>
        )}
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
          showEdits={edited}
        />
      </Paper>
    </Box>
  );
}
