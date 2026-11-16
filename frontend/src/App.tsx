import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import RequirePerm from './auth/RequirePerm';
import AppLayout from './components/AppLayout';
import DocumentDetailPage from './pages/DocumentDetailPage';
import AnnotationPage from './pages/AnnotationPage';
import DocumentsPage from './pages/DocumentsPage';
import LoginPage from './pages/LoginPage';
import StatsPage from './pages/StatsPage';
import UsersPage from './pages/UsersPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/documents" element={<RequirePerm perms={['view_documents']}><DocumentsPage /></RequirePerm>} />
          {/* Detail opens from Filter Table, Annotation or Edit Stats. */}
          <Route
            path="/documents/:id"
            element={<RequirePerm perms={['view_documents', 'view_annotation', 'view_stats']}><DocumentDetailPage /></RequirePerm>}
          />
          <Route path="/annotation" element={<RequirePerm perms={['view_annotation']}><AnnotationPage /></RequirePerm>} />
          <Route path="/annotation/:ean" element={<RequirePerm perms={['view_annotation']}><AnnotationPage /></RequirePerm>} />
          <Route path="/annotation/:ean/:batch" element={<RequirePerm perms={['view_annotation']}><AnnotationPage /></RequirePerm>} />
          <Route path="/stats" element={<RequirePerm perms={['view_stats']}><StatsPage /></RequirePerm>} />
          <Route path="/users" element={<RequirePerm perms={['manage_users']}><UsersPage /></RequirePerm>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
