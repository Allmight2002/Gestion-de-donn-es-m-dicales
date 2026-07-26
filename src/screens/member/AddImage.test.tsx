// @vitest-environment jsdom
// Tests de rendu de l'ajout de document (cahier §8.8, §14) avec repo INJECTE.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { AddImage } from './AddImage';
import type { AttachmentRepository, AddImageInput } from '../../data/attachments';

function renderAddImage(addImage: AttachmentRepository['addImage']) {
  const attachments = { async listAttachments() { return []; }, addImage } as unknown as AttachmentRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider attachments={attachments}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/images/new']}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId/images/new" element={<AddImage />} />
            <Route path="/bases/:id/patients/:patientId" element={<div>DETAIL PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

const fileInput = () => screen.getByLabelText(/fichier/i);
const labelInput = () => screen.getByLabelText(/libellé du document/i);

describe('AddImage (documents)', () => {
  test('refuse un format non autorise (ex: .txt)', async () => {
    const addImage = vi.fn(async (_i: AddImageInput) => ({ id: 'a1' }));
    renderAddImage(addImage);
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'note.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText(/format non autoris/i)).toBeInTheDocument();
    expect(addImage).not.toHaveBeenCalled();
  });

  test('le libelle ET la deidentification sont obligatoires', async () => {
    const addImage = vi.fn(async (_i: AddImageInput) => ({ id: 'a1' }));
    renderAddImage(addImage);
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'scan.png', { type: 'image/png' })] } });

    const save = screen.getByRole('button', { name: 'Envoyer le document' });
    expect(save).toBeDisabled(); // ni libelle ni deidentification
    await userEvent.click(screen.getByRole('checkbox'));
    expect(save).toBeDisabled(); // toujours pas de libelle
    fireEvent.change(labelInput(), { target: { value: 'IRM cerebrale' } });
    expect(save).toBeEnabled();
  });

  test('accepte un PDF avec libelle (document, envoye tel quel)', async () => {
    const addImage = vi.fn(async (_i: AddImageInput) => ({ id: 'a1' }));
    renderAddImage(addImage);
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'cr.pdf', { type: 'application/pdf' })] } });
    expect(screen.queryByText(/format non autoris/i)).toBeNull();

    fireEvent.change(labelInput(), { target: { value: 'Compte-rendu operatoire' } });
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le document' }));

    expect(await screen.findByText('DETAIL PAGE')).toBeInTheDocument();
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addImage.mock.calls[0][0]).toMatchObject({
      deidentificationConfirmed: true, label: 'Compte-rendu operatoire', patientId: 'p1', baseId: 'b1',
    });
  });
});
