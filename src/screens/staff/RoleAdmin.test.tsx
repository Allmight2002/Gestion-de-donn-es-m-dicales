// @vitest-environment jsdom
// Test de rendu de l'administration des roles (cahier v3.0) avec repo INJECTE.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { RoleAdmin } from './RoleAdmin';
import type { AdminRepository, AdminProfile } from '../../data/admin';
import type { GlobalRole } from '../../auth/types';

const profiles: AdminProfile[] = [
  { id: 'u1', fullName: 'Dr Alice Martin', globalRole: 'medecin' },
  { id: 'u2', fullName: 'Carl Curateur', globalRole: 'curateur' },
  { id: 'u3', fullName: 'Admin Systeme', globalRole: 'system_admin' },
];

function renderRoleAdmin(setGlobalRole: AdminRepository['setGlobalRole']) {
  const admin = { async listProfiles() { return profiles; }, setGlobalRole } as unknown as AdminRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider admin={admin}>
        <MemoryRouter initialEntries={['/admin/roles']}>
          <Routes>
            <Route path="/admin/roles" element={<RoleAdmin />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('RoleAdmin', () => {
  test('liste les comptes ; le system_admin est en lecture seule', async () => {
    renderRoleAdmin(vi.fn(async () => {}));
    expect(await screen.findByText('Dr Alice Martin')).toBeInTheDocument();
    expect(screen.getByText('Carl Curateur')).toBeInTheDocument();
    // 2 selects (medecin, curateur) ; le system_admin n'a pas de select.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  test('attribuer un role appelle setGlobalRole', async () => {
    const setGlobalRole = vi.fn(async (_id: string, _role: GlobalRole) => {});
    renderRoleAdmin(setGlobalRole);
    await screen.findByText('Carl Curateur');
    const curateurSelect = screen.getAllByRole('combobox').find((s) => (s as HTMLSelectElement).value === 'curateur')!;
    fireEvent.change(curateurSelect, { target: { value: 'medecin' } });
    await waitFor(() => expect(setGlobalRole).toHaveBeenCalledWith('u2', 'medecin'));
  });
});
