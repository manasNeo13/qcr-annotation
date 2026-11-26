import dayjs from 'dayjs';
import { z } from 'zod';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string) => ISO.test(v) && dayjs(v).isValid();

// Every field optional: photo may not show it → leave blank.
export const metadataSchema = z
  .object({
    mfgDate: z
      .string()
      .refine((v) => !v || isDate(v), 'Enter a valid date')
      .refine((v) => !v || !dayjs(v).isAfter(dayjs(), 'day'), 'Cannot be in the future'),
    expiryDate: z.string().refine((v) => !v || isDate(v), 'Enter a valid date'),
    batchNumber: z
      .string()
      .trim()
      .max(30, 'Max 30 characters')
      .regex(/^[A-Za-z0-9 .\-/]*$/, 'Letters, numbers, space, . - / only'),
    mrp: z
      .string()
      .trim()
      .refine((v) => !v || /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount (max 2 decimals)')
      .refine((v) => !v || Number(v) > 0, 'Must be greater than 0')
      .refine((v) => !v || Number(v) <= 1_000_000, 'Amount too large'),
  })
  .refine(
    (d) => !isDate(d.mfgDate) || !isDate(d.expiryDate) || dayjs(d.expiryDate).isAfter(dayjs(d.mfgDate), 'day'),
    { path: ['expiryDate'], message: 'Expiry must be after manufacturing date' },
  );

export type MetadataFormValues = z.infer<typeof metadataSchema>;

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

/** New password rule. Mirrors backend lib/validation.js `newPassword`. */
export const newPasswordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(100, 'At most 100 characters')
  .regex(/[A-Za-z]/, 'Add at least one letter')
  .regex(/[0-9]/, 'Add at least one number');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordSchema,
    confirm: z.string().min(1, 'Type the new password again'),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: "Passwords don't match" })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'New password must be different' });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
