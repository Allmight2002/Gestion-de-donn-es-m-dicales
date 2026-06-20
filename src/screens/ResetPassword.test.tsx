// @vitest-environment jsdom
// Ecran de definition d'un nouveau mot de passe (cahier : reinitialisation). Backend
// d'auth INJECTE (aucun reseau / Supabase).
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthProvider } from '../auth/AuthProvider';
import type { AuthBackend } from '../auth/backend';
import { ResetPassword } from './ResetPassword';

function fakeBackend(updatePassword: AuthBackend['updatePassword']): AuthBackend {
  return {
    configured: true,
    async getSession() { return null; },
    onAuthChange() { return () => {}; },
    async signIn() {},
    async signOut() {},
    async fetchProfile() { return null; },
    async sendPasswordReset() {},
    updatePassword,
  };
}

function renderScreen(updatePassword: AuthBackend['updatePassword']) {
  return render(
    <I18nProvider>
      <AuthProvider backend={fakeBackend(updatePassword)}>
        <MemoryRouter initialEntries={['/reset-password']}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('ResetPassword', () => {
  test('refuse si les deux mots de passe different (pas d appel backend)', async () => {
    const updatePassword = vi.fn(async () => {});
    renderScreen(updatePassword);
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'abcd1234' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'different1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Définir le mot de passe' }));
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  test('refuse un mot de passe trop court', async () => {
    const updatePassword = vi.fn(async () => {});
    renderScreen(updatePassword);
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'abc' } });
    await userEvent.click(screen.getByRole('button', { name: 'Définir le mot de passe' }));
    expect(await screen.findByText(/au moins 8 caractères/i)).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  test('met a jour le mot de passe et affiche la confirmation', async () => {
    const updatePassword = vi.fn(async () => {});
    renderScreen(updatePassword);
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'abcd1234' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'abcd1234' } });
    await userEvent.click(screen.getByRole('button', { name: 'Définir le mot de passe' }));
    expect(await screen.findByText('Mot de passe mis à jour.')).toBeInTheDocument();
    expect(updatePassword).toHaveBeenCalledWith('abcd1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });
});
