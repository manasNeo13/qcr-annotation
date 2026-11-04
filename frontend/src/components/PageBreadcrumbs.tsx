import { Link as RouterLink } from 'react-router-dom';
import { Breadcrumbs, Link, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { colors } from '../theme';

export interface Crumb {
  label: string;
  /** Omit on current (last) crumb. */
  to?: string;
}

/** Breadcrumb trail. Last crumb = current page (not a link). */
export default function PageBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumbs
      separator={<NavigateNextIcon sx={{ fontSize: 16, color: colors.subtle }} />}
      aria-label="Breadcrumb"
      sx={{ mb: 1.5, fontSize: 13.5, '& .MuiBreadcrumbs-ol': { flexWrap: 'wrap' } }}
      maxItems={6}
    >
      {items.map((c, i) =>
        c.to && i < items.length - 1 ? (
          <Link
            key={i}
            component={RouterLink}
            to={c.to}
            underline="hover"
            sx={{ color: colors.muted, fontWeight: 600, fontSize: 13.5 }}
          >
            {c.label}
          </Link>
        ) : (
          <Typography
            key={i}
            aria-current="page"
            sx={{
              color: colors.textDark,
              fontWeight: 600,
              fontSize: 13.5,
              maxWidth: { xs: 180, sm: 360 },
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
