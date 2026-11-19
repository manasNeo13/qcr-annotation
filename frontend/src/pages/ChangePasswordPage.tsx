import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { changePasswordSchema, type ChangePasswordValues } from '../utils/validation';
import '../styles/auth.css';

function PwField({
  id,
  label,
  autoComplete,
  error,
  reg,
  hint,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error?: string;
  reg: UseFormRegisterReturn;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="nq-field">
      <label className="nq-label" htmlFor={id}>
        {label}
      </label>
      <div className="nq-pw">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          className={`nq-input${error ? ' err' : ''}`}
          aria-invalid={!!error}
          aria-describedby={`${id}-msg`}
          {...reg}
        />
        <button type="button" className="nq-pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
        </button>
      </div>
      {error ? (
        <span id={`${id}-msg`} className="nq-ferr">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-msg`} className="nq-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Set own password. Forced after signing in with a temporary password (admin-set);
 * also reachable from the account menu.
 */
export default function ChangePasswordPage() {
  const { mustChangePassword, passwordChanged, logout, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const onSubmit = async (v: ChangePasswordValues) => {
    setServerError(null);
    try {
      const { token } = await api.changePassword(v.currentPassword, v.newPassword);
      passwordChanged(token);
      qc.invalidateQueries();
      toast.success('Password updated');
      navigate('/documents', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update password';
      if (/current password/i.test(msg)) setError('currentPassword', { message: msg });
      else setServerError(msg);
    }
  };

  const signOut = () => {
    navigate('/login', { replace: true });
    logout();
    qc.clear();
  };

  return (
    <div className="nq">
      <main className="nq-auth-form">
        <div className="nq-card">
          <div className="nq-wordmark">
            Neo<em>QCR</em>
          </div>
          <span className="nq-eyebrow">
            <span className="nq-signal" /> {user?.email}
          </span>
          <h2>{mustChangePassword ? 'Set your password' : 'Change password'}</h2>
          <p className="nq-sub">
            {mustChangePassword
              ? 'You signed in with a temporary password. Choose your own to continue.'
              : 'Pick a new password for your account.'}
          </p>

          {serverError && (
            <div className="nq-alert" role="alert">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <PwField
              id="current"
              label={mustChangePassword ? 'Temporary password' : 'Current password'}
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              reg={register('currentPassword')}
            />
            <PwField
              id="new"
              label="New password"
              autoComplete="new-password"
              error={errors.newPassword?.message}
              reg={register('newPassword')}
              hint="At least 8 characters, with a letter and a number"
            />
            <PwField
              id="confirm"
              label="Confirm new password"
              autoComplete="new-password"
              error={errors.confirm?.message}
              reg={register('confirm')}
            />
            <button type="submit" className="nq-btn nq-btn-primary nq-btn-block" disabled={isSubmitting}>
              {isSubmitting ? <span className="nq-spin" aria-label="Saving" /> : 'Save password'}
            </button>
          </form>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            {mustChangePassword ? (
              <button type="button" className="nq-link" onClick={signOut}>
                Sign out
              </button>
            ) : (
              <button type="button" className="nq-link" onClick={() => navigate(-1)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
