import dayjs from 'dayjs';
import type { DocStatus, StatusFilter } from '../types';

/** Near expiry = remaining shelf life below this % of total (expiry − mfg). Same as backend. */
export const NEAR_EXPIRY_PCT = 30;

export function getStatus(mfgDate: string, expiryDate: string, today = dayjs().startOf('day')): DocStatus {
  const exp = dayjs(expiryDate);
  if (!expiryDate || !exp.isValid()) return 'ok';
  if (exp.isBefore(today, 'day')) return 'expired';
  const mfg = dayjs(mfgDate);
  const total = exp.diff(mfg, 'day');
  if (mfgDate && mfg.isValid() && total > 0 && (exp.diff(today, 'day') / total) * 100 < NEAR_EXPIRY_PCT) return 'near_expiry';
  return 'ok';
}

export const STATUS_META: Record<DocStatus, { label: string; bg: string; fg: string; dot: string }> = {
  ok: { label: 'OK', bg: '#ecfdf5', fg: '#007849', dot: '#00ac69' },
  near_expiry: { label: 'Near expiry', bg: '#fff7e6', fg: '#aa7000', dot: '#f4a100' },
  expired: { label: 'Expired', bg: '#fff5f5', fg: '#a20e00', dot: '#ff413a' },
};

export const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'near_expiry', label: 'Near expiry' },
  { value: 'expired', label: 'Expired' },
];
