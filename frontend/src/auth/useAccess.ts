import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Permission } from '../utils/permissions';
import { useAuth } from './AuthContext';

/**
 * Current role + permissions (GET /auth/me). Refetched on focus / every minute
 * so role changes by an admin apply without re-login. Backend enforces too.
 */
export function useAccess() {
  const { token } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me', token],
    queryFn: () => api.getMe(),
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const permissions: Permission[] = data?.permissions ?? [];
  return {
    me: data,
    permissions,
    loading: isLoading,
    error: isError,
    can: (p: Permission) => permissions.includes(p),
    canAny: (...ps: Permission[]) => ps.some((p) => permissions.includes(p)),
  };
}
