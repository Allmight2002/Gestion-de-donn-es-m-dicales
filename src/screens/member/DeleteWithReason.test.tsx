// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DeleteWithReason } from './DeleteWithReason';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderDelete(props: Partial<React.ComponentProps<typeof DeleteWithReason>> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn(async () => {});
  render(<I18nProvider><DeleteWithReason onConfirm={onConfirm} {...props} /></I18nProvider>);
  return onConfirm;
}

async function openWithReason(reason = 'doublon') {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Supprimer' }));
  await user.type(screen.getByLabelText('Motif de la suppression'), reason);
  return user;
}

describe('DeleteWithReason', () => {
  test('attend le succès avant de fermer et invalide la vue seulement après accusé serveur', async () => {
    const pending = deferred<void>();
    const onSuccess = vi.fn();
    const onConfirm = renderDelete({ onConfirm: vi.fn(() => pending.promise), onSuccess });
    const user = await openWithReason();
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(screen.getByLabelText('Motif de la suppression')).toHaveValue('doublon');
    expect(onSuccess).not.toHaveBeenCalled();
    pending.resolve();
    await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test('bloque le double clic et l’annulation pendant une requête lente', async () => {
    const pending = deferred<void>();
    const onConfirm = renderDelete({ onConfirm: vi.fn(() => pending.promise) });
    const user = await openWithReason();
    const confirm = screen.getByRole('button', { name: 'Confirmer' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    pending.resolve();
    await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
  });

  test.each(['RPC refusée', 'Network request failed', 'Accès refusé', 'CONFLIT_VERSION'])(
    'garde le motif et permet un retry après %s',
    async (message) => {
      const onConfirm = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(undefined);
      renderDelete({ onConfirm });
      const user = await openWithReason('raison conservée');
      await user.click(screen.getByRole('button', { name: 'Confirmer' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message === 'CONFLIT_VERSION' ? /modifiée entre-temps/i : message);
      expect(screen.getByLabelText('Motif de la suppression')).toHaveValue('raison conservée');
      await user.click(screen.getByRole('button', { name: 'Confirmer' }));
      await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
      expect(onConfirm).toHaveBeenCalledTimes(2);
    },
  );

  test('permet l’annulation après un échec sans masquer l’erreur comme un succès', async () => {
    renderDelete({ onConfirm: vi.fn(async () => { throw new Error('Permission révoquée'); }) });
    const user = await openWithReason();
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument();
  });

  test('réconcilie une réponse perdue par une relecture sans rejouer la suppression', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('Network request failed'); });
    const verifyDeletedAfterError = vi.fn(async () => true);
    const onSuccess = vi.fn();
    renderDelete({ onConfirm, verifyDeletedAfterError, onSuccess });
    const user = await openWithReason();
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
    expect(verifyDeletedAfterError).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteWithReason — validation locale du motif', () => {
  async function open() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    return user;
  }

  test('motif vide : bouton confirmer désactivé, aucun appel serveur', async () => {
    const onConfirm = renderDelete();
    await open();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('motif uniquement composé d’espaces : bouton désactivé, aucun appel serveur', async () => {
    const onConfirm = renderDelete();
    const user = await open();
    await user.type(screen.getByLabelText('Motif de la suppression'), '     ');
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('motif > 1000 caractères : message clair, aucun appel serveur', async () => {
    const onConfirm = renderDelete();
    const user = await open();
    // On contourne maxLength via fireEvent pour prouver la GARDE APPLICATIVE, pas le seul attribut HTML.
    fireEvent.change(screen.getByLabelText('Motif de la suppression'), { target: { value: 'a'.repeat(1001) } });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/1000 caractères/);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('caractère de contrôle interdit : message clair, aucun appel serveur', async () => {
    const onConfirm = renderDelete();
    const user = await open();
    // Caractère de contrôle (U+0001) exprimé via fromCharCode pour éviter un octet invisible dans la source.
    fireEvent.change(screen.getByLabelText('Motif de la suppression'), { target: { value: `motif${String.fromCharCode(1)}invalide` } });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/caractères de contrôle/);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('motif valide proche de la limite (1000) : accepté et transmis au serveur', async () => {
    const reason = 'a'.repeat(1000);
    const onConfirm = vi.fn(async () => {});
    renderDelete({ onConfirm });
    const user = await open();
    fireEvent.change(screen.getByLabelText('Motif de la suppression'), { target: { value: reason } });
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(reason));
  });

  test('après un rejet serveur : motif conservé, bouton réactivé, correction du motif puis retry', async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('Motif refusé'))
      .mockResolvedValueOnce(undefined);
    renderDelete({ onConfirm });
    const user = await openWithReason('premier motif');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Motif refusé');
    const input = screen.getByLabelText('Motif de la suppression');
    expect(input).toHaveValue('premier motif');
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled();
    await user.clear(input);
    await user.type(input, 'motif corrigé');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenNthCalledWith(2, 'motif corrigé');
  });
});

describe('DeleteWithReason — échec de réconciliation', () => {
  test('verifyDeletedAfterError → false : dialogue ouvert, motif gardé, erreur visible, pas de succès, retry possible', async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('Suppression refusée'))
      .mockResolvedValueOnce(undefined);
    const verifyDeletedAfterError = vi.fn(async () => false); // la ressource existe toujours cote serveur
    const onSuccess = vi.fn();
    renderDelete({ onConfirm, verifyDeletedAfterError, onSuccess });
    const user = await openWithReason('motif gardé');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Suppression refusée');
    expect(screen.getByLabelText('Motif de la suppression')).toHaveValue('motif gardé');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(verifyDeletedAfterError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled();

    // Un nouveau retry reste possible (cette fois le serveur confirme).
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(screen.queryByLabelText('Motif de la suppression')).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test('verifyDeletedAfterError qui lève : l’erreur initiale n’est pas masquée et le dialogue reste ouvert', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('Erreur initiale'); });
    const verifyDeletedAfterError = vi.fn(async () => { throw new Error('lecture impossible'); });
    const onSuccess = vi.fn();
    renderDelete({ onConfirm, verifyDeletedAfterError, onSuccess });
    const user = await openWithReason('motif gardé');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Erreur initiale');        // l'erreur d'origine reste l'erreur actionnable
    expect(alert).not.toHaveTextContent('lecture impossible');  // l'échec de réconciliation ne la masque pas
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Motif de la suppression')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeEnabled();
  });
});
