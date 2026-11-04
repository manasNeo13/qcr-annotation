import { NONE_KEY } from '../types';

export const eanLabel = (k: string) => (k === NONE_KEY ? 'No EAN' : k);
export const batchLabel = (k: string) => (k === NONE_KEY ? 'No batch' : k);

/** /annotation[/:ean[/:batch]] + query. */
export function annotationPath(ean?: string, batch?: string, qs?: URLSearchParams | string) {
  let p = '/annotation';
  if (ean) p += `/${encodeURIComponent(ean)}`;
  if (ean && batch) p += `/${encodeURIComponent(batch)}`;
  const q = qs?.toString();
  return q ? `${p}?${q}` : p;
}
