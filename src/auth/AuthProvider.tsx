import { errorMessage } from '../lib/errorMessage';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthBackend } from './backend';
import { supabaseBackend } from '../lib/supabaseBackend';
import {
  initializeOfflineForUser,
  isOfflineEnabled,
  purgeAllOfflineData,
  setOfflineUser,
  type OfflineInitializationReport,
} from '../data/offline';
import { clearDraftsForCurrentUser, purgeExpiredDrafts } from '../data/drafts';
import type { AuthStatus, Profile, SessionUser } from './types';
import {
  authorizePwaRegistrationAfterCleanup,
  setPwaRegistrationAllowed,
} from '../pwa/registrationPolicy';

const OFFLINE_PROFILE_PREFIX = 'meddata:offline-profile:';
const OFFLINE_PROFILE_TTL_MS = 24 * 3600 * 1000;

interface OfflineProfileMarker {
  version: 1;
  userId: string;
  globalRole: 'medecin';
  language: string;
  expiresAt: number;
}

const offlineProfileKey = (userId: string) => `${OFFLINE_PROFILE_PREFIX}${userId}`;

function removeOfflineProfile(userId: string): void {
  try { localStorage.removeItem(offlineProfileKey(userId)); } catch { /* fermeture stricte */ }
}

// Le mode demo ne conserve que l'autorisation minimale necessaire a la lecture analytique
// hors-ligne. Aucun nom, email, token, profil brut ni donnee clinique n'est ajoute ici.
function persistOfflineProfile(profile: Profile): void {
  if (!isOfflineEnabled() || typeof localStorage === 'undefined') return;
  const key = offlineProfileKey(profile.id);
  try {
    if (profile.globalRole !== 'medecin') {
      removeOfflineProfile(profile.id);
      return;
    }
    const marker: OfflineProfileMarker = {
      version: 1,
      userId: profile.id,
      globalRole: 'medecin',
      language: profile.language,
      expiresAt: Date.now() + OFFLINE_PROFILE_TTL_MS,
    };
    localStorage.setItem(key, JSON.stringify(marker));
  } catch { /* stockage local indisponible : aucun fallback, donc fermeture stricte */ }
}

function readOfflineProfile(userId: string): Profile | null {
  if (
    !isOfflineEnabled()
    || typeof localStorage === 'undefined'
    || typeof navigator === 'undefined'
    || navigator.onLine !== false
  ) return null;
  const key = offlineProfileKey(userId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const marker = JSON.parse(raw) as Partial<OfflineProfileMarker>;
    if (
      marker.version !== 1
      || marker.userId !== userId
      || marker.globalRole !== 'medecin'
      || typeof marker.language !== 'string'
      || typeof marker.expiresAt !== 'number'
      || marker.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return { id: userId, fullName: '', globalRole: 'medecin', language: marker.language };
  } catch {
    removeOfflineProfile(userId);
    return null;
  }
}

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  profile: Profile | null;
  error: string | null;
  busy: boolean;
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<boolean>;
  updatePassword(newPassword: string): Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface Props {
  children: ReactNode;
  /** Injectable pour les tests ; defaut = backend Supabase reel. */
  backend?: AuthBackend;
  initializeOffline?: (userId: string) => Promise<OfflineInitializationReport>;
}

export function AuthProvider({ children, backend = supabaseBackend, initializeOffline = initializeOfflineForUser }: Props) {
  const [status, setStatus] = useState<AuthStatus>(backend.configured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const currentSessionUser = useRef<SessionUser | null>(null);
  const currentUserId = useRef<string | null>(null);
  const currentProfile = useRef<Profile | null>(null);
  const profileNeedsRefresh = useRef(false);
  const profileRequest = useRef<{ userId: string; promise: Promise<Profile | null> } | null>(null);
  const authGeneration = useRef(0);
  const signOutInProgress = useRef(false);

  const applyUser = useCallback(
    async (nextUser: SessionUser | null) => {
      const generation = ++authGeneration.current;
      const isCurrentGeneration = () => mounted.current && authGeneration.current === generation;
      const userChanged = currentSessionUser.current?.id !== nextUser?.id;
      if (!nextUser || userChanged) {
        // Desarme la registration AVANT toute purge : un callback Workbox tardif sera rejete.
        setPwaRegistrationAllowed(false);
        setStatus('loading');
      }
      // §5.5/§5.6/§5.9 : le cache hors-ligne est cloisonne par compte.
      if (!nextUser) {
        // §5.9 : on efface les instantanes de l'utilisateur COURANT AVANT de le remettre a null
        // (sinon on effacerait ceux du compte « null », pas les siens).
        clearDraftsForCurrentUser();
        if (!signOutInProgress.current) {
          const purge = await purgeAllOfflineData();
          if (purge.errors.length) setError(`Purge locale incomplete: ${purge.errors.join('; ')}`);
        }
        setOfflineUser(null);
        currentSessionUser.current = null;
        currentUserId.current = null;
        currentProfile.current = null;
        profileNeedsRefresh.current = false;
        profileRequest.current = null;
        if (!isCurrentGeneration()) return;
        setUser(null);
        setProfile(null);
        setStatus('signed_out');
        return;
      }
      currentSessionUser.current = nextUser;
      const offlineInit = await initializeOffline(nextUser.id);
      if (offlineInit.errors.length) setPwaRegistrationAllowed(false);
      const pwaCleanupReady = offlineInit.errors.length === 0
        ? await authorizePwaRegistrationAfterCleanup(isCurrentGeneration)
        : false;
      if (!isCurrentGeneration()) return;
      const canRegisterPwa = offlineInit.errors.length === 0 && pwaCleanupReady;
      const initializationErrors = [...offlineInit.errors];
      if (!pwaCleanupReady && offlineInit.errors.length === 0) {
        initializationErrors.push('Service Worker: nettoyage local incomplet');
      }
      if (initializationErrors.length) setError(`Purge locale incomplete: ${initializationErrors.join('; ')}`);
      else setError(null);
      if (currentUserId.current === nextUser.id && currentProfile.current && !profileNeedsRefresh.current) {
        if (isCurrentGeneration()) setPwaRegistrationAllowed(canRegisterPwa);
        return;
      }
      try {
        let req = profileRequest.current;
        if (!req || req.userId !== nextUser.id) {
          req = { userId: nextUser.id, promise: backend.fetchProfile(nextUser.id) };
          profileRequest.current = req;
        }
        const nextProfile = await req.promise;
        if (profileRequest.current === req) profileRequest.current = null;
        if (!isCurrentGeneration()) return;
        currentUserId.current = nextUser.id;
        currentProfile.current = nextProfile;
        profileNeedsRefresh.current = false;
        if (nextProfile) persistOfflineProfile(nextProfile);
        else removeOfflineProfile(nextUser.id);
        setPwaRegistrationAllowed(canRegisterPwa);
        setUser(nextUser);
        setProfile(nextProfile);
        setStatus('signed_in');
      } catch {
        profileRequest.current = null;
        // Hors-ligne explicite : reutilise seulement le marqueur medecin minimal et non expire.
        // Si navigator se dit en ligne, l'echec reste strictement ferme (profil null).
        if (!isCurrentGeneration()) return;
        const offlineProfile = offlineInit.errors.length === 0 ? readOfflineProfile(nextUser.id) : null;
        currentUserId.current = nextUser.id;
        currentProfile.current = offlineProfile;
        profileNeedsRefresh.current = offlineProfile !== null;
        setPwaRegistrationAllowed(canRegisterPwa);
        setUser(nextUser);
        setProfile(offlineProfile);
        setStatus('signed_in');
      }
    },
    [backend, initializeOffline],
  );

  useEffect(() => {
    mounted.current = true;
    purgeExpiredDrafts(); // Brouillons locaux ephemeres : purge au demarrage
    if (!backend.configured) {
      setPwaRegistrationAllowed(false);
      setStatus('unconfigured');
      return;
    }
    void backend.getSession().then(applyUser);
    const unsubscribe = backend.onAuthChange((u) => void applyUser(u));
    return () => {
      setPwaRegistrationAllowed(false);
      mounted.current = false;
      unsubscribe();
    };
  }, [backend, applyUser]);

  // Au retour du reseau, remplace immediatement le marqueur local par le profil serveur. La RLS
  // reste la source de verite pour les ecritures pendant cette courte reconciliation.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = () => {
      const activeUser = currentSessionUser.current;
      if (profileNeedsRefresh.current && activeUser) void applyUser(activeUser);
    };
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [applyUser]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        await backend.signIn(email, password);
        return true;
      } catch (e) {
        setError(errorMessage(e, 'Echec de la connexion'));
        return false;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [backend],
  );

  const signOut = useCallback(async () => {
    authGeneration.current += 1;
    signOutInProgress.current = true;
    setPwaRegistrationAllowed(false);
    setStatus('loading');
    clearDraftsForCurrentUser();
    const purge = await purgeAllOfflineData();
    if (purge.errors.length) setError(`Purge locale incomplete: ${purge.errors.join('; ')}`);
    setOfflineUser(null);
    currentSessionUser.current = null;
    currentUserId.current = null;
    currentProfile.current = null;
    profileNeedsRefresh.current = false;
    profileRequest.current = null;
    try {
      await backend.signOut();
    } finally {
      signOutInProgress.current = false;
    }
    authGeneration.current += 1;
    if (!mounted.current) return;
    setUser(null);
    setProfile(null);
    setStatus('signed_out');
  }, [backend]);

  const sendPasswordReset = useCallback(
    async (email: string) => {
      setBusy(true);
      setError(null);
      try {
        await backend.sendPasswordReset(email);
        return true;
      } catch (e) {
        setError(errorMessage(e, 'Echec de l envoi'));
        return false;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [backend],
  );

  const updatePassword = useCallback(
    async (newPassword: string) => {
      setBusy(true);
      setError(null);
      try {
        await backend.updatePassword(newPassword);
        return true;
      } catch (e) {
        setError(errorMessage(e, 'Echec de la mise a jour'));
        return false;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [backend],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, profile, error, busy, signIn, signOut, sendPasswordReset, updatePassword }),
    [status, user, profile, error, busy, signIn, signOut, sendPasswordReset, updatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
