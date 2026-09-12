// UX-16 — le role diagnostique et l'emplacement sont deux sujets.
//
// L'ecran proposait une liste filtree sans jamais dire pourquoi une variable n'y figurait pas :
// le concepteur cherchait une variable absente sans savoir quoi corriger. Les criteres sont
// desormais lisibles a cote de la liste, et lus par la MEME fonction que la liste elle-meme.
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { TemplateField, TemplateVersion, ValidationRule } from '../../data/types';
import type { TemplateRepository } from '../../data/templates';
import { I18nProvider } from '../../i18n/I18nProvider';
import { DiagnosisConfigurationEditor } from './DiagnosisConfigurationEditor';

const field = (overrides: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type'>): TemplateField => ({
  id: overrides.fieldKey, scope: 'patient', section: null, unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  ...overrides,
});

const version: TemplateVersion = {
  id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft', diagnosisConfiguration: [],
};

const fields: TemplateField[] = [
  field({ fieldKey: 'dx', label: 'Diagnostic retenu', type: 'select', allowedValues: ['a'] }),
  field({ fieldKey: 'dx_autre', label: 'Diagnostic — préciser', type: 'text' }),
  field({ fieldKey: 'imc', label: 'IMC', type: 'number', formula: 'poids / taille' }),
  field({ fieldKey: 'stade', label: 'Stade', type: 'select', allowedValues: ['i'] }),
  field({ fieldKey: 'dx_bloc', label: 'Diagnostic du bloc', type: 'select', allowedValues: ['a'], section: 'clinique' }),
];

// Une regle d'affichage gouverne « stade » : le role exige une variable toujours disponible.
const rules: ValidationRule[] = [{
  id: 'r1', severity: 'block', message: null,
  rule: { if: { field: 'dx', operator: 'equals', value: 'a' }, then: { field: 'stade', operator: 'visible' } },
}];

function renderEditor() {
  render(<I18nProvider>
    <DiagnosisConfigurationEditor
      version={version} fields={fields} rules={rules}
      sections={[{ id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }]}
      repo={{ setDiagnosisConfiguration: vi.fn() } as unknown as TemplateRepository}
      busy={false} run={vi.fn(async () => true)}
    />
  </I18nProvider>);
}

describe('DiagnosisConfigurationEditor — criteres lisibles (UX-16)', () => {
  test('nomme le role sans imposer un emplacement et explique chaque refus', async () => {
    renderEditor();

    // Le titre ne designe plus une place dans le formulaire : la variable est deplacable.
    const select = screen.getByLabelText('Variable diagnostique');
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/Son emplacement dans le formulaire est libre/)).toBeInTheDocument();

    // Seule la variable compatible est proposee.
    expect([...select.querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['Non configuré', 'Diagnostic retenu (dx)']);

    // Les trois refus sont nommes, chacun avec SON motif.
    const refused = screen.getByText(/ne peuvent pas porter ce rôle \(3\)/);
    expect(refused).toBeInTheDocument();
    const list = refused.closest('details') as HTMLElement;
    expect(list.textContent).toMatch(/Diagnostic — préciser.*type incompatible/s);
    expect(list.textContent).toMatch(/IMC.*variable calculée/s);
    expect(list.textContent).toMatch(/Stade.*masquée par une règle d’affichage/s);

    // Une variable compatible rangee dans un bloc n'est pas proposee : le dire evite de la
    // chercher, et dit ce qui la rendrait eligible.
    expect(screen.getByText(/1 variable\(s\) compatibles appartiennent à un bloc clinique/)).toBeInTheDocument();
  });
});
