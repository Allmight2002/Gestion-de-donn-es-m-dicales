// Infrastructure E2E navigateur reutilisable (socle du lot 10).
//
// Principes (audit lot 10, correction 2) :
//  - identifiants charges UNIQUEMENT depuis l'environnement (aucun secret dans le depot) ;
//  - donnees entierement fictives, prefixees et uniques PAR RUN (pas de collision, residu
//    identifiable) ;
//  - garde anti-production explicite avant toute fixture serveur ;
//  - nettoyage best-effort du residu via la RPC applicative (jamais pour SIMULER le parcours) ;
//  - messages d'erreur explicites quand une fixture requise est indisponible.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';

export type Role = 'MEDECIN' | 'CURATEUR' | 'ADMIN';

// Identifiant unique par execution : un code patient reste unique meme si deux runs se
// chevauchent ou qu'un run precedent a laisse du residu apres un echec.
export const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Code patient fictif garanti unique pour ce run. */
export function uniquePatientCode(prefix = 'E2E'): string {
  return `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

// --- identifiants (environnement uniquement) --------------------------------------------
export function credentials(role: Role): { email: string; password: string } {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`Infrastructure E2E incomplete : E2E_${role}_EMAIL / E2E_${role}_PASSWORD requis.`);
  }
  return { email, password };
}

export function hasCredentials(role: Role): boolean {
  return Boolean(process.env[`E2E_${role}_EMAIL`] && process.env[`E2E_${role}_PASSWORD`]);
}

// --- connexion via l'INTERFACE (aucune injection de session) ----------------------------
export async function signIn(page: Page, role: Role): Promise<void> {
  const { email, password } = credentials(role);
  await page.goto('/login');
  await page.getByLabel(/Adresse e-mail|Email address/i).fill(email);
  await page.getByLabel(/Mot de passe|Password/i).fill(password);
  await page.getByRole('button', { name: /Se connecter|Sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

// --- garde anti-production pour les fixtures SERVEUR ------------------------------------
// Par defaut, seul le projet STAGING connu est autorise (aligne sur scripts/e2e-staging.mjs).
// Toute autre cible (dont la production) provoque un ECHEC BRUYANT, jamais un skip silencieux.
const DEFAULT_ALLOWED_REFS = ['gmsxrniiclrheehhoakn'];

function allowedProjectRefs(): string[] {
  const extra = (process.env.E2E_ALLOWED_PROJECT_REFS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_REFS, ...extra];
}

export function assertNonProductionSupabase(url: string): void {
  if (process.env.E2E_TARGET !== 'staging') {
    throw new Error('Les fixtures serveur E2E exigent E2E_TARGET=staging (la production est interdite).');
  }
  const allowed = allowedProjectRefs();
  if (!allowed.some((ref) => url.includes(ref))) {
    throw new Error(
      `URL Supabase refusee pour les fixtures E2E (${url}). ` +
        `Projets autorises : ${allowed.join(', ')}. La production ne doit jamais etre visee.`,
    );
  }
}

// --- backend des fixtures (optionnel) ---------------------------------------------------
export interface FixtureBackend {
  url: string;
  anonKey: string;
}

/** true si un backend Supabase est configure pour les fixtures (URL + cle anon). */
export function backendConfigured(): boolean {
  return Boolean(process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY);
}

/** Backend valide et NON production, ou leve une erreur explicite (tripwire anti-prod). */
export function fixtureBackend(): FixtureBackend {
  const url = process.env.E2E_SUPABASE_URL;
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Fixture indisponible : E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY requis.');
  }
  assertNonProductionSupabase(url);
  return { url, anonKey };
}

// --- identifiants de donnees semees (fournies par l'environnement staging) --------------
export const seedBaseId = (): string | undefined => process.env.E2E_MEDECIN_BASE_ID;
export const exportBaseId = (): string | undefined => process.env.E2E_EXPORT_BASE_ID;
export const exportCohortId = (): string | undefined => process.env.E2E_EXPORT_COHORT_ID;

// --- client Supabase reserve au SETUP / NETTOYAGE des fixtures --------------------------
// Jamais utilise pour simuler le parcours principal (qui passe exclusivement par l'UI).
export async function medecinClient(): Promise<SupabaseClient> {
  const backend = fixtureBackend();
  const { email, password } = credentials('MEDECIN');
  const client = createClient(backend.url, backend.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Fixture indisponible : connexion medecin impossible (${error.message}).`);
  return client;
}

// Nettoyage best-effort du residu d'un test interrompu : suppression LOGIQUE du patient via
// la RPC applicative (nettoyage de test explicitement autorise). Les erreurs sont ignorees
// (patient deja supprime, backend indisponible) — le nettoyage ne doit jamais masquer l'echec.
export async function cleanupPatient(patientId: string): Promise<void> {
  let client: SupabaseClient | null = null;
  try {
    client = await medecinClient();
    await client.rpc('soft_delete_patient', {
      p_patient_id: patientId,
      p_reason: `Nettoyage fixture E2E ${RUN_ID}`,
    });
  } catch {
    /* best-effort : ne jamais transformer un nettoyage en echec de test. */
  } finally {
    await client?.auth.signOut().catch(() => {});
  }
}
