// @vitest-environment jsdom
// C2 v1 : liste des groupes (creation) + detail (bases rattachees, detacher).
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { GroupList } from './GroupList';
import { GroupDetail } from './GroupDetail';
import type { GroupRepository } from '../../data/groups';
import type { BaseRepository, BaseListing } from '../../data/bases';

const listing = (id: string, name: string): BaseListing => ({
  base: { id, name, specialty: 'Neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'T', versionNumber: 1,
});

describe('GroupList (C2)', () => {
  test('affiche les groupes et cree un groupe', async () => {
    const createGroup = vi.fn(async () => ({ id: 'g2' }));
    const groups = {
      async listGroups() { return [{ id: 'g1', name: 'Neuro-onco', createdAt: '2026-01-01', baseCount: 2 }]; },
      createGroup,
    } as unknown as GroupRepository;
    render(
      <I18nProvider>
        <RepositoryProvider groups={groups}>
          <MemoryRouter initialEntries={['/groups']}>
            <Routes><Route path="/groups" element={<GroupList />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(await screen.findByText('Neuro-onco')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nom du groupe'), { target: { value: 'Cardio' } });
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('Cardio'));
  });
});

describe('GroupDetail (C2)', () => {
  test('affiche les bases rattachees et detache une base', async () => {
    const detachBase = vi.fn(async () => {});
    const groups = {
      async listGroups() { return [{ id: 'g1', name: 'Neuro-onco', createdAt: '2026-01-01', baseCount: 1 }]; },
      async getGroupBases() { return [{ id: 'b1', name: 'Gliomes', specialty: 'Neuro' }]; },
      detachBase,
    } as unknown as GroupRepository;
    const bases = { async listMyBases() { return [listing('b2', 'Méningiomes')]; } } as unknown as BaseRepository;
    render(
      <I18nProvider>
        <RepositoryProvider groups={groups} bases={bases}>
          <MemoryRouter initialEntries={['/groups/g1']}>
            <Routes><Route path="/groups/:groupId" element={<GroupDetail />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(await screen.findByText('Gliomes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await waitFor(() => expect(detachBase).toHaveBeenCalledWith('b1'));
  });
});
