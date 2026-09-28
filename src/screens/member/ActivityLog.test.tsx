// @vitest-environment jsdom
// C3 : le journal d'activite rend des libelles LISIBLES + un repli pour une action inconnue.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ActivityLog } from './ActivityLog';
import type { AuditRepository } from '../../data/audit';

const makeAudit = (getBaseActivity: AuditRepository['getBaseActivity']): AuditRepository => ({
  logIdentityRead: async () => undefined,
  logRawDocumentRead: async () => undefined,
  logAttachmentRead: async () => undefined,
  logExportRead: async () => undefined,
  getBaseActivity,
});

function renderActivity(audit: AuditRepository) {
  render(
    <I18nProvider>
      <RepositoryProvider audit={audit}>
        <MemoryRouter initialEntries={['/bases/b1/activity']}>
          <Routes><Route path="/bases/:id/activity" element={<ActivityLog />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('ActivityLog (C3)', () => {
  test('affiche les libelles lisibles, le detail d import, et un repli pour action inconnue', async () => {
    const audit = makeAudit(async () => [
      { id: 'a1', at: '2026-07-03T10:00:00.000Z', action: 'data_imported', actorName: 'Dr Mbassi', metadata: { patients_new: 5, patients_updated: 2, encounters: 12, errors: 1 } },
      { id: 'a2', at: '2026-07-03T09:00:00.000Z', action: 'access_granted', actorName: 'Dr Mbassi', metadata: {} },
      { id: 'a3', at: '2026-07-03T08:00:00.000Z', action: 'weird_unknown_action', actorName: 'Dr Ngo', metadata: null },
    ]);

    renderActivity(audit);

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Import de données')).toBeInTheDocument();
    expect(within(list).getByText('Accès accordé')).toBeInTheDocument();
    expect(within(list).getByText('weird_unknown_action')).toBeInTheDocument(); // repli sur l'action brute
    expect(within(list).getByText(/7 patients · 12 rencontres · 1 erreurs/)).toBeInTheDocument(); // detail (5+2)
  });

  // Audit UI mobile, lot 0 — ces actions ecrites par les migrations s'affichaient en code brut
  // (`mission_credentials_revealed`…), illisible et insecable sur telephone. Le filtre, lui,
  // garde sa liste courte : traduire l'affichage n'ajoute aucune option.
  test('traduit les actions de mission, de cohorte et d identite au lieu du code brut', async () => {
    const audit = makeAudit(async () => [
      { id: 'a1', at: '2026-08-21T10:00:00.000Z', action: 'cohort_deleted', actorName: 'Compte a798aa8b', metadata: {} },
      { id: 'a2', at: '2026-08-20T10:00:00.000Z', action: 'mission_credentials_revealed', actorName: 'Compte a798aa8b', metadata: {} },
      { id: 'a3', at: '2026-08-19T10:00:00.000Z', action: 'mission_credentials_creation_requested', actorName: 'Compte a798aa8b', metadata: {} },
      { id: 'a4', at: '2026-08-18T10:00:00.000Z', action: 'patient_identity_corrected', actorName: 'Compte a798aa8b', metadata: {} },
    ]);
    renderActivity(audit);

    // Quatre jours, quatre listes : le journal se lit par jour (lot 4).
    expect(await screen.findAllByRole('list')).toHaveLength(4);
    expect(screen.getByText('Cohorte supprimée')).toBeInTheDocument();
    expect(screen.getByText('Mot de passe de mission affiché')).toBeInTheDocument();
    expect(screen.getByText('Identifiants de mission demandés')).toBeInTheDocument();
    expect(screen.getByText('Identité du patient corrigée')).toBeInTheDocument();
    expect(screen.queryByText(/_/)).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Filtrer par action' })).getAllByRole('button')).toHaveLength(13);
  });

  // E6 — apres une evolution du formulaire, l'historique doit repondre a « qui a change quoi,
  // quand, et vers quelle revision ». Le detail vient de l'INSTANTANE minimise par le serveur :
  // l'ecran ne relit aucune version de gabarit vivante.
  test('resume une evolution du formulaire : revision, ajouts et fiches concernees', async () => {
    const audit = makeAudit(async () => [
      {
        id: 'a1',
        at: '2026-09-17T10:00:00.000Z',
        action: 'form_preparation_applied',
        actorName: 'Dr Mbassi',
        metadata: {
          classification: 'additive',
          source_revision: 4,
          target_revision: 5,
          added_fields: 2,
          added_required_fields: 1,
          added_rules: 1,
          added_diagnosis_associations: 1,
          affected_patients: 12,
          affected_encounters: 30,
          added_field_keys: ['date_debut_symptomes', 'poids_admission'],
        },
      },
    ]);
    renderActivity(audit);

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Formulaire modifié')).toBeInTheDocument();
    const detail = within(list).getByText(/révision 5/);
    expect(detail).toHaveTextContent('2 variables ajoutées (1 dont obligatoires)');
    expect(detail).toHaveTextContent('1 règles ajoutées');
    expect(detail).toHaveTextContent('1 associations diagnostiques');
    expect(detail).toHaveTextContent('42 fiches concernées');
    expect(detail).toHaveTextContent('date_debut_symptomes, poids_admission');
  });

  // Un collaborateur non proprietaire recoit les compteurs sans le detail nominatif ; l'ecran
  // ne doit pas combler ce vide par une phrase inventee.
  test('sans detail nominatif, le resume reste vrai et ne comble rien', async () => {
    const audit = makeAudit(async () => [
      {
        id: 'a1',
        at: '2026-09-17T10:00:00.000Z',
        action: 'form_preparation_applied',
        actorName: 'Dr Ngo',
        metadata: { classification: 'additive', target_revision: 5, added_fields: 0 },
      },
    ]);
    renderActivity(audit);

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Formulaire modifié')).toBeInTheDocument();
    expect(within(list).getByText('révision 5')).toBeInTheDocument();
    expect(within(list).queryByText(/variables ajoutées/)).toBeNull();
  });

  test('filtre le journal par action', async () => {
    const getBaseActivity = vi.fn<AuditRepository['getBaseActivity']>(async (_baseId, options) => {
      if (options?.action === 'access_revoked') {
        return [{ id: 'a2', at: '2026-07-03T11:00:00.000Z', action: 'access_revoked', actorName: 'Dr Mbassi', metadata: {} }];
      }
      return [{ id: 'a1', at: '2026-07-03T10:00:00.000Z', action: 'access_granted', actorName: 'Dr Mbassi', metadata: {} }];
    });
    renderActivity(makeAudit(getBaseActivity));

    expect(within(await screen.findByRole('list')).getByText('Accès accordé')).toBeInTheDocument();
    const filters = within(screen.getByRole('group', { name: 'Filtrer par action' }));
    expect(filters.getByRole('button', { name: 'Toutes les actions' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(filters.getByRole('button', { name: 'Accès révoqué' }));
    expect(filters.getByRole('button', { name: 'Accès révoqué' })).toHaveAttribute('aria-pressed', 'true');

    expect(within(await screen.findByRole('list')).getByText('Accès révoqué')).toBeInTheDocument();
    expect(getBaseActivity).toHaveBeenLastCalledWith('b1', { limit: 50, action: 'access_revoked' });
  });

  // Audit UI mobile, lot 4 (5.9-B, decision 8) : une carte par jour, et « Vous » seulement quand
  // le serveur le dit. Face a un serveur anterieur (sans drapeau), le nom reste affiche.
  test('regroupe par jour et dit « Vous » pour ses propres actions, d apres le serveur seulement', async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    renderActivity(makeAudit(async () => [
      { id: 'a1', at: now.toISOString(), action: 'export_created', actorName: 'Dr Mbassi', actorIsSelf: true, metadata: {} },
      { id: 'a2', at: yesterday.toISOString(), action: 'access_granted', actorName: 'Dr Ngo', actorIsSelf: false, metadata: {} },
      { id: 'a3', at: '2025-03-02T12:00:00.000Z', action: 'access_changed', actorName: 'Dr Mbassi', metadata: {} },
    ]));

    const today = await screen.findByRole('list', { name: 'Aujourd’hui' });
    expect(within(today).getByText('Export généré')).toBeInTheDocument();
    expect(within(today).getByText('Vous')).toBeInTheDocument();
    expect(within(today).queryByText('Dr Mbassi')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Hier' })).getByText('Dr Ngo')).toBeInTheDocument();
    // Pas de drapeau : aucune deduction depuis le nom, meme identique a celui de l'appelant.
    const older = screen.getByRole('list', { name: /2 mars 2025/ });
    expect(within(older).getByText('Dr Mbassi')).toBeInTheDocument();
    expect(within(older).queryByText('Vous')).toBeNull();
  });

  test('charge la page suivante avec un curseur temporel', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({
      id: `a${String(i).padStart(2, '0')}`,
      at: new Date(Date.UTC(2026, 6, 3, 10, 0 - i, 0)).toISOString(),
      action: 'access_granted',
      actorName: 'Dr Mbassi',
      metadata: {},
    }));
    const getBaseActivity = vi.fn<AuditRepository['getBaseActivity']>(async (_baseId, options) => {
      if (options?.before) {
        return [{ id: 'next', at: '2026-07-03T08:00:00.000Z', action: 'export_created', actorName: 'Dr Mbassi', metadata: {} }];
      }
      return firstPage;
    });
    renderActivity(makeAudit(getBaseActivity));

    const loadMore = await screen.findByRole('button', { name: 'Charger plus' });
    await userEvent.click(loadMore);

    expect(within(await screen.findByRole('list')).getByText('Export généré')).toBeInTheDocument();
    expect(getBaseActivity).toHaveBeenLastCalledWith('b1', {
      before: firstPage[49].at,
      beforeId: firstPage[49].id,
      limit: 50,
      action: null,
    });
  });
});
