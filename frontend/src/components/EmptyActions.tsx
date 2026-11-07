import { Button } from '@mui/material';
import type { ListState } from '../hooks/useListState';

/** "Show all dates" / "Clear filters" buttons for empty lists. */
export default function EmptyActions({ state }: { state: ListState }) {
  const { allDates, filter, setRange, setSearch, update } = state;
  const hasFilters = !!(filter.q || filter.status !== 'all' || filter.client || filter.changed);
  return (
    <>
      {!allDates && (
        <Button variant="outlined" color="secondary" sx={{ mt: 2, mr: 1 }} onClick={() => setRange()}>
          Show all dates
        </Button>
      )}
      {hasFilters && (
        <Button
          variant="outlined"
          color="secondary"
          sx={{ mt: 2 }}
          onClick={() => {
            setSearch('');
            update({ q: null, status: null, client: null, changed: null, editor: null, page: null });
          }}
        >
          Clear filters
        </Button>
      )}
    </>
  );
}
