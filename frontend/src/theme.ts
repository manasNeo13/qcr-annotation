import { createTheme } from '@mui/material/styles';

/** Tokens from style.md (default "All" green theme). */
export const colors = {
  primary: '#00ac69',
  primaryLight: '#4ade80',
  primaryDark: '#16a34a',
  brandDark: '#007849',
  brandSoft: '#ecfdf5',
  brand100: '#a7f3d0',
  accent: '#00cfd5',
  background: '#f0f2f8',
  paper: '#ffffff',
  surface2: '#f8fafc',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  textPrimary: '#242c3a',
  textSecondary: '#1b212c',
  textDark: '#12171e',
  muted: '#425466',
  subtle: '#94a3b8',
} as const;

export const brandGrad = 'linear-gradient(120deg, #00ac69 0%, #00ac69 45%, #00cfd5 130%)';
export const brandGradHover = 'linear-gradient(120deg, #007849 0%, #00ac69 45%, #00cfd5 120%)';

const fontFamily = "'Baloo 2', system-ui, sans-serif";

export const theme = createTheme({
  palette: {
    primary: { light: colors.primaryLight, main: colors.primary, dark: colors.primaryDark, contrastText: '#fff' },
    secondary: { light: '#60696d', main: '#425466', dark: '#272f33' },
    error: { light: '#ec4333', main: '#ff413a', dark: '#a20e00' },
    warning: { light: '#f6b333', main: '#f4a100', dark: '#aa7000', contrastText: '#fff' },
    info: { light: '#33d8dd', main: '#00cfd5', dark: '#009095' },
    success: { light: '#33bc87', main: '#00ac69', dark: '#007849', contrastText: '#fff' },
    background: { default: colors.background, paper: colors.paper },
    text: { primary: colors.textPrimary, secondary: colors.muted },
    divider: colors.border,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily,
    h1: { fontSize: '2.2rem', fontWeight: 600, color: colors.textDark },
    h2: { fontSize: '2rem', fontWeight: 600, color: colors.textDark },
    h3: { fontSize: '1.5rem', fontWeight: 600, color: colors.textDark },
    h4: { fontSize: '1.25rem', fontWeight: 500, color: colors.textSecondary },
    h5: { fontSize: '1.125rem', fontWeight: 600, color: colors.textSecondary },
    h6: { fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary },
    subtitle1: { fontSize: '0.875rem', fontWeight: 500, color: colors.textSecondary, lineHeight: '1.643em' },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 400 },
    body1: { fontSize: '0.875rem', fontWeight: 400, lineHeight: '1.643em' },
    body2: { fontWeight: 400, lineHeight: '1.643em' },
    caption: { fontSize: '0.68rem', fontWeight: 500, color: '#00000061' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 10 },
        elevation1: { boxShadow: '0 4px 6px -2px rgb(0 0 0 / 12%), 0 2px 2px -1px rgb(0 0 0 / 5%)' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 40,
          paddingInline: 18,
          transition: 'all .2s',
          variants: [
            {
              props: { variant: 'contained', color: 'primary' },
              style: {
                background: brandGrad,
                boxShadow: '0 6px 18px rgba(0,172,105,.22)',
                '&:hover': { background: brandGradHover, boxShadow: '0 12px 30px rgba(0,172,105,.30)' },
              },
            },
            {
              props: { variant: 'outlined', color: 'secondary' },
              style: {
                borderColor: colors.borderStrong,
                color: colors.muted,
                background: '#fff',
                '&:hover': { borderColor: colors.primary, color: colors.brandDark, background: colors.brandSoft },
              },
            },
          ],
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 600 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          background: colors.surface2,
          color: colors.textDark,
          transition: 'box-shadow .2s, background .2s',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.borderStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: colors.subtle },
          '&.Mui-focused': { background: '#fff', boxShadow: '0 0 0 4px rgba(0,172,105,.14)' },
          '&.Mui-error': { background: '#fff5f5' },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { background: colors.background, fontWeight: 600, color: colors.textDark, whiteSpace: 'nowrap' },
        root: { borderColor: colors.border },
      },
    },
    MuiTableContainer: { styleOverrides: { root: { boxShadow: 'none' } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          color: colors.muted,
          borderColor: colors.borderStrong,
          gap: 8,
          whiteSpace: 'nowrap',
          '&.Mui-selected': { color: colors.brandDark, background: colors.brandSoft, borderColor: colors.primary },
          '&.Mui-selected:hover': { background: '#d1fae5' },
        },
      },
    },
    MuiSvgIcon: { styleOverrides: { root: { fontSize: '1.3rem' }, fontSizeLarge: { fontSize: '2.1875rem' } } },
  },
});
