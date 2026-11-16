import { useSearchParams } from 'react-router-dom';
import { Box, Paper, Tab, Tabs } from '@mui/material';
import AuditTab from '../components/admin/AuditTab';
import RolesTab from '../components/admin/RolesTab';
import UsersTab from '../components/admin/UsersTab';
import PageBreadcrumbs from '../components/PageBreadcrumbs';
import { colors } from '../theme';

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles & permissions' },
  { key: 'log', label: 'Change log' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** User management (manage_users): users, role permission matrix, change log. Tab in URL (?tab=). */
export default function UsersPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as TabKey) : 'users';

  return (
    <Box className="nq-fade-up">
      <PageBreadcrumbs items={[{ label: 'Users' }]} />
      <Paper sx={{ overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v: TabKey) => setParams(v === 'users' ? {} : { tab: v }, { replace: true })}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ px: { xs: 1, sm: 2 }, borderBottom: `1px solid ${colors.border}` }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} sx={{ fontWeight: 700 }} />
          ))}
        </Tabs>
        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'log' && <AuditTab />}
      </Paper>
    </Box>
  );
}
