import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Box, InputAdornment, TextField } from '@mui/material';
import type { DocMetadata } from '../types';
import { metadataSchema, type MetadataFormValues } from '../utils/validation';

interface Props {
  formId: string;
  initial: DocMetadata;
  disabled?: boolean;
  onSubmit: (values: DocMetadata) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** One row of 4 (full-screen bar). */
  compact?: boolean;
  /** Unsaved values to restore on mount (form moved between page and full screen). */
  draft?: MetadataFormValues | null;
  onDraftChange?: (values: MetadataFormValues | null) => void;
}

const toForm = (m: DocMetadata): MetadataFormValues => ({
  mfgDate: m.mfgDate ?? '',
  expiryDate: m.expiryDate ?? '',
  batchNumber: m.batchNumber ?? '',
  mrp: m.mrp == null ? '' : String(m.mrp),
});

export default function MetadataForm({ formId, initial, disabled, onSubmit, onDirtyChange, compact, draft, onDraftChange }: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<MetadataFormValues>({
    resolver: zodResolver(metadataSchema),
    defaultValues: toForm(initial),
    mode: 'onTouched',
  });

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  // Restore unsaved values once on mount (draft from the other place this form was shown).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !draft) return;
    restored.current = true;
    for (const k of Object.keys(draft) as (keyof MetadataFormValues)[]) setValue(k, draft[k], { shouldDirty: true });
  }, [draft, setValue]);
  // Report current values → page keeps them as draft.
  useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch((v) => onDraftChange(v as MetadataFormValues));
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  const submit = (v: MetadataFormValues) =>
    onSubmit({
      mfgDate: v.mfgDate,
      expiryDate: v.expiryDate,
      batchNumber: v.batchNumber.trim().toUpperCase(),
      mrp: v.mrp.trim() ? Math.round(Number(v.mrp) * 100) / 100 : null,
    });

  const field = (name: keyof MetadataFormValues) => ({
    ...register(name),
    error: !!errors[name],
    helperText: errors[name]?.message ?? ' ',
    disabled,
    fullWidth: true,
  });

  return (
    <Box
      component="form"
      id={formId}
      noValidate
      onSubmit={handleSubmit(submit)}
      sx={{
        display: 'grid',
        gridTemplateColumns: compact ? { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' } : { xs: '1fr', sm: '1fr 1fr' },
        columnGap: 2,
        rowGap: 0.5,
      }}
    >
      <TextField
        label="Manufacturing date"
        type="date"
        {...field('mfgDate')}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Expiry date"
        type="date"
        {...field('expiryDate')}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Batch number"
        {...field('batchNumber')}
        slotProps={{
          htmlInput: { style: { textTransform: 'uppercase', fontFamily: 'ui-monospace, monospace' }, maxLength: 30 },
        }}
      />
      <TextField
        label="MRP"
        inputMode="decimal"
        {...field('mrp')}
        slotProps={{
          input: { startAdornment: <InputAdornment position="start">₹</InputAdornment> },
          htmlInput: { inputMode: 'decimal' },
        }}
      />
    </Box>
  );
}
