import '@testing-library/jest-dom/vitest';
import { loadMessages } from './i18n/messages';
import { vi } from 'vitest';

// Component tests inject their repositories. New server-draft tests provide their own
// WorkDraftRepository; the default singleton must never contact an environment database.
vi.mock('./data/workDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data/workDrafts')>();
  return { ...actual, workDraftRepository: actual.createWorkDraftRepository(null) };
});

await loadMessages('fr');
