/** Sentinel client filter value: captures with no client (NHQ only). Mirrors backend NONE_KEY. */
export const NO_CLIENT = '__none__';

/** "reliance-sap" → "Reliance-Sap"; NO_CLIENT → "No client". */
export const clientLabel = (c: string) => (c === NO_CLIENT ? 'No client' : c.replace(/\b\w/g, (x) => x.toUpperCase()));
