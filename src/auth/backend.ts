// Abstraction du backend d'auth : decouple le provider React de Supabase.
// -> permet d'injecter un faux backend dans les tests (sans reseau ni Supabase).
import type { Profile, SessionUser } from './types';

export interface AuthBackend {
  /** false quand les variables d'env Supabase sont absentes. */
  readonly configured: boolean;
  getSession(): Promise<SessionUser | null>;
  /** S'abonne aux changements de session ; renvoie une fonction de desabonnement. */
  onAuthChange(callback: (user: SessionUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  fetchProfile(userId: string): Promise<Profile | null>;
  sendPasswordReset(email: string): Promise<void>;
  /** Definit un nouveau mot de passe pour la session courante (ex. apres un lien de
   *  recuperation, qui ouvre une session temporaire). */
  updatePassword(newPassword: string): Promise<void>;
}

/** Backend inerte utilise quand Supabase n'est pas configure. */
export const unconfiguredBackend: AuthBackend = {
  configured: false,
  async getSession() {
    return null;
  },
  onAuthChange() {
    return () => {};
  },
  async signIn() {
    throw new Error('Backend Supabase non configure');
  },
  async signOut() {},
  async fetchProfile() {
    return null;
  },
  async sendPasswordReset() {
    throw new Error('Backend Supabase non configure');
  },
  async updatePassword() {
    throw new Error('Backend Supabase non configure');
  },
};
