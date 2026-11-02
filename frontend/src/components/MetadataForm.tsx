import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
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
}

const toForm = (m: DocMetadata): MetadataFormValues => ({
  mfgDate: m.mfgDate,
  expiryDate: m.expiryDate,
  batchNumber: m.batchNumber,
  mrp: m.mrp == null ? '' : String(m.mrp),
});

export default function MetadataForm({ formId, initial, disabled, onSubmit, onDirtyChange }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<MetadataFormValues>({
    resolver: zodResolver(metadataSchema),
    defaultValues: toForm(initial),
    mode: 'onTouched',
  });

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const submit = (v: MetadataFormValues) =>
    onSubmit({
      mfgDate: v.mfgDate,
      expiryDate: v.expiryDate,
      batchNumber: v.batchNumber.trim().toUpperCase(),
      mrp: Math.round(Number(v.mrp) * 100) / 100,
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
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2, rowGap: 0.5 }}
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
