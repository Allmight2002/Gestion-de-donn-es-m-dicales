// Liste des modeles proposes a la creation d'une base : un modele officiel n'est propose que
// par sa derniere version publiee ; un jeu personnel reste propose meme en brouillon.
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test, vi } from 'vitest';
import { makeBaseRepository } from '../src/data/bases';

function clientReturning(rows: unknown[]) {
  const order = vi.fn(async () => ({ data: rows, error: null }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, select };
}

describe('listTemplateModels', () => {
  test('modele officiel : derniere version publiee, jamais un brouillon ni une version archivee', async () => {
    const { client, select } = clientReturning([
      { id: 'g1', name: 'Officiel', specialty: null, is_global: true, template_version: [
        { id: 'g1v1', version_number: 1, status: 'archived' },
        { id: 'g1v2', version_number: 2, status: 'published' },
        { id: 'g1v3', version_number: 3, status: 'draft' },
      ] },
      { id: 'g2', name: 'Officiel en preparation', specialty: null, is_global: true, template_version: [
        { id: 'g2v1', version_number: 1, status: 'draft' },
      ] },
    ]);
    const models = await makeBaseRepository(client).listTemplateModels();
    expect(select).toHaveBeenCalledWith(expect.stringContaining('status'));
    expect(models).toEqual([
      { versionId: 'g1v2', versionNumber: 2, templateId: 'g1', name: 'Officiel', specialty: null, scope: 'global' },
    ]);
  });

  test('jeu personnel : derniere version, brouillon compris', async () => {
    const { client } = clientReturning([
      { id: 'p1', name: 'Perso', specialty: 'neuro', is_global: false, template_version: [
        { id: 'p1v1', version_number: 1, status: 'published' },
        { id: 'p1v2', version_number: 2, status: 'draft' },
      ] },
    ]);
    await expect(makeBaseRepository(client).listTemplateModels()).resolves.toEqual([
      { versionId: 'p1v2', versionNumber: 2, templateId: 'p1', name: 'Perso', specialty: 'neuro', scope: 'personal' },
    ]);
  });
});
