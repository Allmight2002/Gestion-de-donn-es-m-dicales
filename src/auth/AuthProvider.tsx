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
import { setOfflineUser, clearOfflineSnapshots, purgeExpiredSnapshots } from '../data/offline';
import type { AuthStatus, Profile, SessionUser } from './types';

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
}

export function AuthProvider({ children, backend = supabaseBackend }: Props) {
  const [status, setStatus] = useState<AuthStatus>(backend.configured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const currentUserId = useRef<string | null>(null);
  const currentProfile = useRef<Profile | null>(null);
  const profileRequest = useRef<{ userId: string; promise: Promise<Profile | null> } | null>(null);
  const authGeneration = useRef(0);

  const applyUser = useCallback(
    async (nextUser: SessionUser | null) => {
      const generation = ++authGeneration.current;
      const isCurrentGeneration = () => mounted.current && authGeneration.current === generation;
      // §5.5/§5.6/§5.9 : le cache hors-ligne est cloisonne par compte.
      if (!nextUser) {
        // §5.9 : on efface les instantanes de l'utilisateur COURANT AVANT de le remettre a null
        // (sinon on effacerait ceux du compte « null », pas les siens).
        void clearOfflineSnapshots();
        setOfflineUser(null);
        currentUserId.current = null;
        currentProfile.current = null;
        profileRequest.current = null;
        if (!isCurrentGeneration()) return;
        setUser(null);
        setProfile(null);
        setStatus('signed_out');
        return;
      }
      setOfflineUser(nextUser.id); // (re)cible l'utilisateur courant a la connexion / restauration
      if (currentUserId.current === nextUser.id && currentProfile.current) return;
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
        setUser(nextUser);
        setProfile(nextProfile);
        setStatus('signed_in');
      } catch {
        profileRequest.current = null;
        // Session presente mais profil illisible : on reste connecte sans profil.
        if (!isCurrentGeneration()) return;
        currentUserId.current = nextUser.id;
        currentProfile.current = null;
        setUser(nextUser);
        setProfile(null);
        setStatus('signed_in');
      }
    },
    [backend],
  );

  useEffect(() => {
    mounted.current = true;
    void purgeExpiredSnapshots(); // §5.6 : menage des instantanes expires au demarrage
    if (!backend.configured) {
      setStatus('unconfigured');
      return;
    }
    void backend.getSession().then(applyUser);
    const unsubscribe = backend.onAuthChange((u) => void applyUser(u));
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [backend, applyUser]);

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
    await backend.signOut();
    authGeneration.current += 1;
    currentUserId.current = null;
    currentProfile.current = null;
    profileRequest.current = null;
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
