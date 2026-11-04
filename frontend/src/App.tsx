import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import AppLayout from './components/AppLayout';
import DocumentDetailPage from './pages/DocumentDetailPage';
import AnnotationPage from './pages/AnnotationPage';
import DocumentsPage from './pages/DocumentsPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/annotation" element={<AnnotationPage />} />
          <Route path="/annotation/:ean" element={<AnnotationPage />} />
          <Route path="/annotation/:ean/:batch" element={<AnnotationPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
