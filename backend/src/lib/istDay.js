/** Calendar days are IST (same as main app istDayWindow). */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** 'YYYY-MM-DD'..'YYYY-MM-DD' (IST, inclusive) → UTC Date window. */
export function istWindow(from, to = from) {
  const start = Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS;
  const end = Date.parse(`${to}T23:59:59.999Z`) - IST_OFFSET_MS;
  return { start: new Date(start), end: new Date(end) };
}

/** Date → IST 'YYYY-MM-DD'. */
export const istDay = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
