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
      if (!nextUser) {
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
        setError(e instanceof Error ? e.message : 'Echec de la connexion');
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
        setError(e instanceof Error ? e.message : 'Echec de l envoi');
        return false;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [backend],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, profile, error, busy, signIn, signOut, sendPasswordReset }),
    [status, user, profile, error, busy, signIn, signOut, sendPasswordReset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
