// UX-16 — le role diagnostique et l'emplacement sont deux sujets.
//
// L'ecran proposait une liste filtree sans jamais dire pourquoi une variable n'y figurait pas :
// le concepteur cherchait une variable absente sans savoir quoi corriger. Les criteres sont
// desormais lisibles a cote de la liste, et lus par la MEME fonction que la liste elle-meme.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../../data/types';
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

function renderEditor(overrides: {
  version?: TemplateVersion;
  fields?: TemplateField[];
  rules?: ValidationRule[];
  sections?: TemplateSection[];
  repo?: TemplateRepository;
  run?: (action: () => Promise<unknown>) => Promise<boolean>;
  onOpenField?: (fieldKey: string) => void;
  onOpenRule?: (ruleId: string) => void;
} = {}) {
  const repo = overrides.repo ?? { setDiagnosisConfiguration: vi.fn() } as unknown as TemplateRepository;
  render(<I18nProvider>
    <DiagnosisConfigurationEditor
      version={overrides.version ?? version}
      fields={overrides.fields ?? fields}
      rules={overrides.rules ?? rules}
      sections={overrides.sections ?? [{ id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }]}
      repo={repo}
      busy={false}
      run={overrides.run ?? vi.fn(async () => true)}
      onOpenField={overrides.onOpenField}
      onOpenRule={overrides.onOpenRule}
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

  test('la version brouillon inutilisée laisse les options de configuration actionnables', () => {
    renderEditor();
    const select = screen.getByLabelText('Variable diagnostique');
    expect(select).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enregistrer la configuration' })).not.toBeDisabled();
  });

  test('explique le verrou d’une version utilisée et garde les liens de consultation actifs', () => {
    const associationRule: ValidationRule = {
      id: 'association', severity: 'block', message: null,
      rule: { if: { field: 'dx', operator: 'contains_any', value: ['a'] }, then: { section: 'clinique', operator: 'visible' } },
    };
    const configuredVersion: TemplateVersion = {
      ...version,
      diagnosisConfiguration: [{ scope: 'patient', diagnosisFieldKey: 'dx', terminologyReleaseId: null, commonOnlyCodes: [] }],
    };
    const onOpenField = vi.fn();
    const onOpenRule = vi.fn();
    renderEditor({
      version: configuredVersion,
      fields: fields.map((item) => ({ ...item, inUse: item.fieldKey === 'dx' })),
      rules: [associationRule],
      onOpenField,
      onOpenRule,
    });

    expect(screen.getByRole('status')).toHaveTextContent(/version est déjà utilisée/);
    expect(screen.getByLabelText('Fiche concernée')).not.toBeDisabled();
    expect(screen.getByLabelText('Variable diagnostique')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Diagnostic retenu/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Diagnostic retenu/ }));
    expect(onOpenField).toHaveBeenCalledWith('dx');

    const openRule = screen.getByRole('button', { name: 'Voir la règle d’activation' });
    expect(openRule).not.toBeDisabled();
    fireEvent.click(openRule);
    expect(onOpenRule).toHaveBeenCalledWith('association');
    expect(screen.getByLabelText(/Codes alternatifs déclenchant ce bloc/)).toBeDisabled();
  });
});
