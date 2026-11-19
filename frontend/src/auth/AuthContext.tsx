import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { PASSWORD_CHANGE_EVENT, UNAUTHORIZED_EVENT, authStore } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  /** Signed in with a temporary password → only the "set new password" screen is open. */
  mustChangePassword?: boolean;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  /** After a successful password change: store the fresh token, unlock the app. */
  passwordChanged: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): AuthState {
  try {
    const raw = authStore.get();
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { user: null, token: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readStored);

  const save = useCallback((next: AuthState) => {
    authStore.set(JSON.stringify(next));
    setState(next);
  }, []);

  const logout = useCallback(() => {
    authStore.clear();
    setState({ user: null, token: null });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user, mustChangePassword = false } = await api.login(email, password);
      save({ token, user, mustChangePassword });
      return { mustChangePassword };
    },
    [save],
  );

  const passwordChanged = useCallback(
    (token: string) => save({ ...readStored(), token, mustChangePassword: false }),
    [save],
  );

  useEffect(() => {
    const needPw = () => {
      const cur = readStored();
      if (cur.token && !cur.mustChangePassword) save({ ...cur, mustChangePassword: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    window.addEventListener(PASSWORD_CHANGE_EVENT, needPw);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, logout);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, needPw);
    };
  }, [logout, save]);

  const value = useMemo(
    () => ({ ...state, isAuthenticated: !!state.token, login, passwordChanged, logout }),
    [state, login, passwordChanged, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
