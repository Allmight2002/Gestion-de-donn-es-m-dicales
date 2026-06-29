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

  const applyUser = useCallback(
    async (nextUser: SessionUser | null) => {
      // §5.5/§5.6 : le cache hors-ligne est cloisonne par compte. On (re)cible l'utilisateur
      // courant a CHAQUE changement de session (connexion, restauration, deconnexion).
      setOfflineUser(nextUser?.id ?? null);
      if (!nextUser) {
        void clearOfflineSnapshots(); // donnees analytiques au repos effacees a la deconnexion
        if (!mounted.current) return;
        setUser(null);
        setProfile(null);
        setStatus('signed_out');
        return;
      }
      try {
        const nextProfile = await backend.fetchProfile(nextUser.id);
        if (!mounted.current) return;
        setUser(nextUser);
        setProfile(nextProfile);
        setStatus('signed_in');
      } catch {
        // Session presente mais profil illisible : on reste connecte sans profil.
        if (!mounted.current) return;
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
    await backend.signOut();
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
