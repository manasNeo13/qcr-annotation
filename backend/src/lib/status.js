/**
 * Status rule (same as main QCR app):
 *   expired     → expiry < today
 *   near_expiry → remaining shelf life < NEAR_EXPIRY_PCT % of total (expiry − mfg)
 *   ok          → otherwise (also when dates missing)
 */
export const NEAR_EXPIRY_PCT = 30;

/** Server-local "today" as a UTC-midnight Date (dates compare as calendar days). */
export const startOfToday = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
export const toISODate = (d) => d.toISOString().slice(0, 10);
export const todayISO = () => toISODate(startOfToday());

const ms = (iso) => (iso ? Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) : NaN);

export function getStatus(mfgISO, expiryISO) {
  const exp = ms(expiryISO);
  if (Number.isNaN(exp)) return 'ok';
  const today = startOfToday().getTime();
  if (exp < today) return 'expired';
  const mfg = ms(mfgISO);
  if (!Number.isNaN(mfg) && exp > mfg && ((exp - today) / (exp - mfg)) * 100 < NEAR_EXPIRY_PCT) return 'near_expiry';
  return 'ok';
}
