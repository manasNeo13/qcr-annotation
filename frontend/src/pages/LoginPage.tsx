import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { USE_MOCK } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { loginSchema, type LoginFormValues } from '../utils/validation';
import '../styles/auth.css';

const Wordmark = () => (
  <div className="nq-wordmark">
    Neo<em>QCR</em>
  </div>
);

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/documents';
  const [showPw, setShowPw] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: USE_MOCK ? { email: 'annotator@neoqcr.com', password: 'demo' } : { email: '', password: '' },
  });

  if (isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async (v: LoginFormValues) => {
    setServerError(null);
    try {
      await login(v.email, v.password);
      navigate(from, { replace: true });
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Login failed');
    }
  };

  return (
    <div className="nq">
      <main className="nq-auth-form">
        <div className="nq-card">
          <Wordmark />
          <span className="nq-eyebrow"><span className="nq-signal" /> QCR Annotation</span>
          <h2>Sign in</h2>
          <p className="nq-sub">Use your NeoQCR account to continue.</p>

          {serverError && <div className="nq-alert" role="alert">{serverError}</div>}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="nq-field">
              <label className="nq-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className={`nq-input${errors.email ? ' err' : ''}`}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-err' : undefined}
                {...register('email')}
              />
              {errors.email && <span id="email-err" className="nq-ferr">{errors.email.message}</span>}
            </div>

            <div className="nq-field">
              <label className="nq-label" htmlFor="password">Password</label>
              <div className="nq-pw">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={`nq-input${errors.password ? ' err' : ''}`}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'pw-err' : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  className="nq-pw-toggle"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </button>
              </div>
              {errors.password && <span id="pw-err" className="nq-ferr">{errors.password.message}</span>}
            </div>

            <button type="submit" className="nq-btn nq-btn-primary nq-btn-block" disabled={isSubmitting}>
              {isSubmitting ? <span className="nq-spin" aria-label="Signing in" /> : 'Sign in'}
            </button>
          </form>

          {USE_MOCK && (
            <div className="nq-demo">
              <b>Demo mode.</b> Any email and password will sign you in.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
