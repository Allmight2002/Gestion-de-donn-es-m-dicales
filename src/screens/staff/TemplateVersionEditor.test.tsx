// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField, TemplateSection, TemplateVersion } from '../../data/types';
import { TemplateVersionEditor } from './TemplateVersionEditor';

const version: TemplateVersion = {
  id: 'version-1',
  templateId: 'template-1',
  versionNumber: 3,
  status: 'draft',
};

const sections: TemplateSection[] = [
  { id: 'section-1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 1 },
  { id: 'section-2', sectionKey: 'biologie', label: 'Biologie', displayOrder: 2 },
];

function makeField(overrides: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label'>): TemplateField {
  const { id, fieldKey, label, ...rest } = overrides;
  return {
    id,
    fieldKey,
    label,
    scope: 'encounter',
    section: 'clinique',
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 1,
    ...rest,
  };
}

function makeRepository() {
  let fields: TemplateField[] = [
    makeField({ id: 'field-1', fieldKey: 'tension', label: 'Tension artérielle', required: true }),
    makeField({ id: 'field-2', fieldKey: 'hemoglobine', label: 'Hémoglobine', section: 'biologie', type: 'number', displayOrder: 2 }),
  ];
  const updateField = vi.fn(async (id: string, next: Parameters<TemplateRepository['updateField']>[1]) => {
    const current = fields.find((field) => field.id === id);
    if (!current) throw new Error('Variable introuvable');
    const updated = { ...current, ...next };
    fields = fields.map((field) => (field.id === id ? { ...updated, id } : field));
    return fields.find((field) => field.id === id)!;
  });
  const repo = {
    getVersion: vi.fn(async () => ({ version, fields: [...fields], rules: [], sections })),
    updateField,
  } as unknown as TemplateRepository;
  return { repo, updateField };
}

function renderEditor(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <TemplateVersionEditor versionId={version.id} templateName="Registre fictif" onBack={() => {}} />
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('TemplateVersionEditor', () => {
  test('regroupe les variables et filtre par libelle ou cle technique', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    renderEditor(repo);

    expect(await screen.findByRole('heading', { name: 'Registre fictif' })).toBeInTheDocument();
    expect(screen.getByText('Version 3 · Brouillon')).toBeInTheDocument();
    expect(screen.getByText('Clinique', { selector: 'summary span' })).toBeInTheDocument();
    expect(screen.getByText('Biologie', { selector: 'summary span' })).toBeInTheDocument();
    expect(screen.getAllByText(/1 variable\(s\)/).length).toBeGreaterThanOrEqual(2);

    const toolbar = screen.getByTestId('template-editor-toolbar');
    expect(toolbar).toHaveClass('md:sticky', 'md:top-0', 'dark:bg-slate-950/95');
    expect(toolbar).not.toHaveClass('sticky', 'top-0');

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une variable' }), 'hemoglobine');

    expect(screen.getByText('Hémoglobine')).toBeInTheDocument();
    expect(screen.queryByText('Tension artérielle')).not.toBeInTheDocument();
    expect(screen.getByText(/Enregistré/)).toHaveTextContent('1 / 2');
  });

  test('ouvre une variable dans le panneau, conserve les valeurs et permet de passer a la suivante', async () => {
    const user = userEvent.setup();
    const { repo, updateField } = makeRepository();
    renderEditor(repo);

    const firstRow = await screen.findByRole('row', { name: /Tension artérielle/ });
    await user.click(within(firstRow).getByRole('button', { name: /Modifier la variable/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Modifier la variable' });
    const label = within(dialog).getByLabelText('Libellé');
    expect(label).toHaveValue('Tension artérielle');
    await user.clear(label);
    await user.type(label, 'Tension corrigée');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer et passer à la suivante' }));

    await waitFor(() => expect(updateField).toHaveBeenCalledWith('field-1', expect.objectContaining({ label: 'Tension corrigée' })));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Modifier la variable' })).getByLabelText('Libellé')).toHaveValue('Hémoglobine'));
  });
});
