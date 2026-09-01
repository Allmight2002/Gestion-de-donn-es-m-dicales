// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { LoginScreen } from './LoginScreen';

function renderLogin(overrides: Partial<AuthContextValue> = {}) {
  const signIn = vi.fn(async () => true);
  const sendPasswordReset = vi.fn(async () => true);
  const value: AuthContextValue = {
    status: 'signed_out',
    user: null,
    profile: null,
    error: null,
    busy: false,
    signIn,
    signOut: async () => undefined,
    sendPasswordReset,
    updatePassword: async () => true,
    ...overrides,
  };
  render(
    <I18nProvider>
      <AuthContext.Provider value={value}><LoginScreen /></AuthContext.Provider>
    </I18nProvider>,
  );
  return { signIn, sendPasswordReset };
}

describe('connexion par identifiant ou email', () => {
  test('demande un identifiant et transmet le mot de passe sans exiger d email', async () => {
    const { signIn } = renderLogin();
    const identifier = screen.getByLabelText(/Identifiant/i);
    expect(identifier).toHaveAttribute('type', 'text');
    expect(identifier).toHaveAttribute('autocomplete', 'username');

    await userEvent.type(identifier, 'mission-neuro-01');
    await userEvent.type(screen.getByLabelText(/Mot de passe/i), 'secret-fictif');
    expect(screen.queryByRole('button', { name: /Mot de passe oublié/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Se connecter/i }));
    expect(signIn).toHaveBeenCalledWith('mission-neuro-01', 'secret-fictif');
  });

  test('garde la reinitialisation email uniquement pour les comptes ordinaires', async () => {
    const { sendPasswordReset } = renderLogin();
    const identifier = screen.getByLabelText(/Identifiant/i);
    await userEvent.type(identifier, 'medecin@example.test');
    await userEvent.click(screen.getByRole('button', { name: /Mot de passe oublié/i }));
    expect(sendPasswordReset).toHaveBeenCalledWith('medecin@example.test');
  });
});
