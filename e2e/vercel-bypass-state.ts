import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hors du depot et des artefacts Playwright : cet etat contient un cookie d'acces temporaire.
export const VERCEL_BYPASS_STORAGE_STATE = join(
  process.env.RUNNER_TEMP ?? tmpdir(),
  'meddata-vercel-bypass-state.json',
);
