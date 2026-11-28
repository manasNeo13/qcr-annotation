import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import toast, { ToastBar, Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { theme } from './theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
      <Toaster
        position="top-right"
        toastOptions={{ style: { fontFamily: "'Baloo 2', sans-serif", fontSize: 14 } }}
      >
        {/* × on every toast so it can be closed right away. */}
        {(t) => (
          <ToastBar toast={t}>
            {({ icon, message }) => (
              <>
                {icon}
                {message}
                {t.type !== 'loading' && (
                  <button
                    type="button"
                    onClick={() => toast.dismiss(t.id)}
                    aria-label="Close"
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#64748b', padding: '0 2px', marginLeft: 4 }}
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </ToastBar>
        )}
      </Toaster>
    </ThemeProvider>
  </StrictMode>,
);
