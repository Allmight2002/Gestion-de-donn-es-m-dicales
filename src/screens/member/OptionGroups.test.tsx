// @vitest-environment jsdom
// L74 — en-tetes d'option sous une liste multiple : criteres 10 a 14 de
// docs/spec-entetes-options-declenchantes.md §8. Donnees fictives uniquement.
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { PatientRepository } from '../../data/patients';
import type { TemplateField, TemplateVersion, ValidationRule } from '../../data/types';
import { hiddenFieldKeys } from '../../domain/validation';
import { I18nProvider } from '../../i18n/I18nProvider';
import { FormPreview } from '../staff/FormPreview';
import { EncounterFields } from './EncounterFields';
import { RepeatableGroup } from './RepeatableGroup';

const field = (over: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label'>): TemplateField => ({
  id: over.fieldKey, scope: 'encounter', section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...over,
});
// Codes volontairement distincts des libelles : l'en-tete doit montrer le libelle.
const complications = field({
  fieldKey: 'complications', label: 'Complications', type: 'multiselect', displayOrder: 1,
  allowedValues: ['inf', 'hem'],
  allowedOptions: [{ value_key: 'inf', label: 'Infection', is_active: true }, { value_key: 'hem', label: 'Hémorragie', is_active: true }],
});
// Ordre global entrelace : Germe 3, Volume 4, Date 5, Reprise 6.
const fields: TemplateField[] = [
  complications,
  field({ fieldKey: 'germe', label: 'Germe', displayOrder: 3, required: true }),
  field({ fieldKey: 'volume', label: 'Volume', type: 'integer', displayOrder: 4, required: true }),
  field({ fieldKey: 'date_infection', label: 'Date de l’infection', displayOrder: 5, required: true }),
  field({ fieldKey: 'reprise', label: 'Reprise chirurgicale', displayOrder: 6, required: true }),
];
const shows = (code: string, target: string): ValidationRule => ({
  id: `${code}-${target}`, severity: 'block', message: null,
  rule: { if: { field: 'complications', operator: 'contains_any', value: [code] }, then: { field: target, operator: 'visible' } },
});
const rules = [shows('inf', 'germe'), shows('hem', 'volume'), shows('inf', 'date_infection'), shows('hem', 'reprise')];

function Form({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  return <form onSubmit={(event) => event.preventDefault()}>
    <EncounterFields fields={fields} values={values} rules={rules} requireComplete
      hiddenKeys={hiddenFieldKeys(rules, values, fields)}
      onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
      onRemove={(key) => setValues((previous) => { const next = { ...previous }; delete next[key]; return next; })} />
  </form>;
}

beforeEach(() => {
  localStorage.setItem('registre.lang', 'fr');
});

describe('SectionedFields — en-tetes d\'option (L74)', () => {
  test('10-11. un regroupement par option cochee, legende = libelle ; decocher retire en-tete et variables', async () => {
    render(<I18nProvider><Form /></I18nProvider>);
    expect(screen.queryByRole('group', { name: 'Infection' })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Infection' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hémorragie' }));
    const infection = screen.getByRole('group', { name: 'Infection' });
    const hemorragie = screen.getByRole('group', { name: 'Hémorragie' });
    expect(within(infection).getByLabelText(/Germe/)).toBeInTheDocument();
    expect(within(infection).getByLabelText(/Date de l’infection/)).toBeInTheDocument();
    expect(within(hemorragie).getByLabelText(/Volume/)).toBeInTheDocument();
    expect(within(hemorragie).getByLabelText(/Reprise chirurgicale/)).toBeInTheDocument();
    // La legende porte le libelle, jamais le code.
    expect(infection.querySelector('legend')).toHaveTextContent(/^Infection$/);
    expect(screen.queryByText('inf')).toBeNull();
    // Les identifiants de champ ne changent pas.
    expect(infection.querySelector('[data-field-key="germe"]')).not.toBeNull();
    // Ordre du document : pilote, Infection, Hemorragie.
    const order = [...document.querySelectorAll<HTMLElement>('[data-field-key]')].map((node) => node.dataset.fieldKey);
    expect(order).toEqual(['complications', 'germe', 'date_infection', 'volume', 'reprise']);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Infection' }));
    expect(screen.queryByRole('group', { name: 'Infection' })).toBeNull();
    expect(screen.queryByLabelText(/Germe/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Hémorragie' })).toBeInTheDocument();
  });

  test('12. « Prochain champ obligatoire manquant » suit l\'ordre affiche', async () => {
    render(<I18nProvider><Form initial={{ complications: ['inf', 'hem'] }} /></I18nProvider>);
    const next = screen.getByRole('button', { name: 'Prochain champ obligatoire manquant' });
    const focused = () => document.activeElement?.closest<HTMLElement>('[data-field-key]')?.dataset.fieldKey;
    const visited: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await userEvent.click(next);
      await waitFor(() => expect(focused() !== undefined && focused() !== visited.at(-1)).toBe(true));
      visited.push(focused()!);
    }
    expect(visited).toEqual(['germe', 'date_infection', 'volume', 'reprise']);
  });

  test('13. une occurrence de groupe repetable regroupe ses variables par option', async () => {
    const patients = { async listEncounters() { return []; } } as unknown as PatientRepository;
    render(
      <I18nProvider>
        <RepositoryProvider patients={patients}>
          <RepeatableGroup section={{ id: 's', sectionKey: 'clinique', label: 'Complications', displayOrder: 0, isRepeatable: true }}
            fields={fields} occurrences={[]} patientId="patient-fictif" canWrite online occurrencesError={null}
            rules={rules} requireComplete={false} onChanged={vi.fn()} />
        </RepositoryProvider>
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hémorragie' }));
    const group = screen.getByRole('group', { name: 'Hémorragie' });
    expect(within(group).getByLabelText(/Volume/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Infection' })).toBeNull();
  });

  test('14. l\'apercu de l\'editeur montre le regroupement, sans code propre', async () => {
    const version: TemplateVersion = { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' };
    render(<I18nProvider><FormPreview version={version} fields={fields} rules={rules} onClose={() => undefined} /></I18nProvider>);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Infection' }));
    const group = screen.getByRole('group', { name: 'Infection' });
    expect(within(group).getByLabelText(/Germe/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/Date de l’infection/)).toBeInTheDocument();
  });
});
