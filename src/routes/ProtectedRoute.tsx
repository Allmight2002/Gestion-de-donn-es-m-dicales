import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { useI18n } from '../i18n/useI18n';
import { isAllowedInArea, landingPathFor, type AppArea } from '../auth/logic';
import type { GlobalRole } from '../auth/types';
import { AppShell } from '../components/AppShell';
import { Skeleton, SkeletonList } from '../components/Skeleton';
import { Unconfigured } from '../screens/Unconfigured';

function FullScreenLoading() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <Skeleton className="h-14 w-full" />
        <div className="card p-5 sm:p-6">
          <Skeleton className="mb-5 h-8 w-2/5" />
          <SkeletonList rows={5} label={t('common.loading')} />
        </div>
      </div>
    </div>
  );
}

/** Route reservee aux personnes connectees ET autorisees dans la zone. */
export function ProtectedRoute({
  area,
  globalRoles,
  children,
}: {
  area: AppArea;
  globalRoles?: readonly GlobalRole[];
  children: ReactNode;
}) {
  const { status, profile } = useAuth();

  if (status === 'loading') return <FullScreenLoading />;
  if (status === 'unconfigured') return <Unconfigured />;
  if (status === 'signed_out') return <Navigate to="/login" replace />;

  // signed_in mais profil illisible : on n'effectue PAS de redirection (evite les
  // boucles) ; on affiche un etat neutre.
  if (!profile) {
    return (
      <AppShell>
        <p className="text-slate-500">Profil indisponible. Veuillez vous reconnecter.</p>
      </AppShell>
    );
  }

  if (!isAllowedInArea(profile, area) || (globalRoles && !globalRoles.includes(profile.globalRole))) {
    return <Navigate to={landingPathFor(profile)} replace />;
  }

  return <AppShell>{children}</AppShell>;
}

/**
 * Garde de role pour une route IMBRIQUEE, deja rendue dans une zone protegee : elle
 * n'ajoute pas de second AppShell, elle se contente de rediriger. Utilisee pour fermer
 * les onglets d'une base a un compte de mission.
 */
export function RequireGlobalRole({
  globalRoles,
  children,
}: {
  globalRoles: readonly GlobalRole[];
  children: ReactNode;
}) {
  const { status, profile } = useAuth();
  if (status === 'loading') return <FullScreenLoading />;
  if (!profile) return <Navigate to="/" replace />;
  if (!globalRoles.includes(profile.globalRole)) return <Navigate to={landingPathFor(profile)} replace />;
  return <>{children}</>;
}

/** Route publique (connexion) : renvoie vers l'accueil si deja connecte. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth();
  if (status === 'loading') return <FullScreenLoading />;
  if (status === 'unconfigured') return <Unconfigured />;
  if (status === 'signed_in') return <Navigate to={profile ? landingPathFor(profile) : '/'} replace />;
  return <>{children}</>;
}
