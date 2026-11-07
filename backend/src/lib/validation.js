import { z } from 'zod';
import { todayISO, toISODate } from './status.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && toISODate(new Date(`${v}T00:00:00Z`)) === v;

// Mirrors frontend utils/validation.ts (MRP arrives as number here).
export const metadataSchema = z
  .object({
    mfgDate: z.string().refine(isDate, 'Enter a valid date').refine((v) => v <= todayISO(), 'Cannot be in the future'),
    expiryDate: z.string().refine(isDate, 'Enter a valid date'),
    batchNumber: z
      .string()
      .trim()
      .min(1, 'Batch number is required')
      .max(30, 'Max 30 characters')
      .regex(/^[A-Za-z0-9 .\-/]+$/, 'Letters, numbers, space, . - / only')
      .transform((v) => v.toUpperCase()),
    mrp: z
      .number()
      .positive('Must be greater than 0')
      .max(1_000_000, 'Amount too large')
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Max 2 decimals'),
  })
  .strict()
  .refine((d) => d.expiryDate > d.mfgDate, { path: ['expiryDate'], message: 'Expiry must be after manufacturing date' });

export const updateBodySchema = z.object({ metadata: metadataSchema }).strict();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(isDate, 'Invalid date');

/** Optional IST day range. to defaults to from; swapped if reversed. */
const withRange = (schema) =>
  schema
    .extend({ from: day.optional(), to: day.optional() })
    .transform((v) => {
      if (!v.from && !v.to) return { ...v, from: undefined, to: undefined };
      const a = v.from ?? v.to;
      const b = v.to ?? v.from;
      return a <= b ? { ...v, from: a, to: b } : { ...v, from: b, to: a };
    });

const listBase = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(15).default(15), // UI shows 15 per page
  q: z.string().trim().max(100).optional().default(''),
  status: z.enum(['all', 'ok', 'near_expiry', 'expired']).optional().default('all'),
  // Scope filter. client = environment.client_name.
  client: z.string().trim().max(100).optional(),
  // Drill-down. NONE_KEY = missing value.
  ean: z.string().trim().max(100).optional(),
  batch: z.string().trim().max(100).optional(),
});
export const listQuerySchema = withRange(listBase);

/** Sentinel for "no EAN" / "no batch" groups. */
export const NONE_KEY = '__none__';

/** Edit stats: capture-day range (omitted = all dates) + client. detail=1 → per-image rows (CSV). */
export const statsQuerySchema = withRange(
  z.object({
    client: z.string().trim().max(100).optional(),
    detail: z.enum(['0', '1']).optional().transform((v) => v === '1'),
  }),
);

export const daysQuerySchema = z.object({
  from: day,
  to: day,
  client: z.string().trim().max(100).optional(),
});

/** Parse or throw 400 with field errors. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = {};
  for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
  const err = new Error(Object.values(fields)[0] || 'Invalid request');
  err.status = 400;
  err.details = fields;
  throw err;
}
