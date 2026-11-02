import dayjs from 'dayjs';

export const formatDate = (iso?: string) => (iso && dayjs(iso).isValid() ? dayjs(iso).format('DD MMM YYYY') : '—');
export const formatDateTime = (iso?: string) =>
  iso && dayjs(iso).isValid() ? dayjs(iso).format('DD MMM YYYY, hh:mm A') : '—';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const formatMRP = (v?: number | null) => (typeof v === 'number' && !Number.isNaN(v) ? inr.format(v) : '—');

/** Date-range button/summary label. */
export function rangeLabel(from?: string, to?: string) {
  if (!from) return 'All dates';
  const a = dayjs(from);
  const b = dayjs(to ?? from);
  if (a.isSame(b, 'day')) return a.format('DD MMM YYYY');
  if (a.isSame(b, 'year')) return `${a.format('DD MMM')} – ${b.format('DD MMM YYYY')}`;
  return `${a.format('DD MMM YYYY')} – ${b.format('DD MMM YYYY')}`;
}
