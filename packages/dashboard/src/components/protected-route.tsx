import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';

interface Props {
  children: React.ReactNode;
  requireGrvt?: boolean;
}

const QUICK_ACCESS_KEY = 'grvt-grid-quick-access';

export function ProtectedRoute({ children, requireGrvt = true }: Props) {
  const { user, token, loading } = useAuth();

  // No API key configured → bypass auth for local dev / self-host.
  const bypassAuth = !import.meta.env.VITE_DASHBOARD_API_KEY;

  // Fast access mode: allow entering the dashboard without JWT login
  // while still using VITE_DASHBOARD_API_KEY for API calls.
  const quickAccessEnabled =
    typeof window !== 'undefined' &&
    window.localStorage.getItem(QUICK_ACCESS_KEY) === '1';

  if (bypassAuth || quickAccessEnabled) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-text-muted animate-pulse">
        Loading...
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (requireGrvt && !user.hasGrvtCreds) {
    return <Navigate to="/onboarding/grvt" replace />;
  }

  return <>{children}</>;
}
