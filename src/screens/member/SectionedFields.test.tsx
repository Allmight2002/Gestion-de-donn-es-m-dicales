import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { TemplateField, ValidationRule } from '../../data/types';
import { I18nProvider } from '../../i18n/I18nProvider';
import { hiddenFieldKeys, makeMissing } from '../../domain/validation';
import { calculateFormProgress } from '../../domain/formProgress';
import { groupFieldsBySection } from '../../domain/templateSections';
import { EncounterFields } from './EncounterFields';
import { SectionedFields } from './SectionedFields';

const field = (key: string, section: string | null, required = false): TemplateField => ({ id: key, fieldKey: key, label: key,
  scope: 'encounter', section, type: 'integer', unit: null, allowedValues: null, required, minValue: 0, maxValue: 10,
  allowMissingCodes: false, displayOrder: key === 'a' ? 0 : 1 });
const fields = [field('a', 'clinique', true), field('b', 'biologie', true)];
const required: ValidationRule = { id: 'r1', severity: 'block', message: 'b requis lorsque a vaut 1', rule: { if: { field: 'a', operator: 'equals', value: 1 }, then: { field: 'b', operator: 'required' } } };
function Example() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return <form onSubmit={(event) => event.preventDefault()}><EncounterFields fields={fields} values={values} requireComplete
    onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
    onRemove={(key) => setValues((previous) => { const next = { ...previous }; delete next[key]; return next; })} />
    <button type="submit">Vérifier</button></form>;
}
describe('long form sections and progress', () => {
  test('UX-16 intercale les rubriques communes autour des blocs sans changer leur section', () => {
    const ux16Fields = [
      field('motif', null),
      field('diagnostic', null),
      field('tension', 'clinique'),
      field('synthese', null),
    ];
    const layout = {
      fingerprint: 'fixture', locked: false, inUse: false, defaultKey: 'contexte', unassigned: [],
      sections: [{ key: 'clinique', label: 'Clinique' }],
      groups: [
        { key: 'contexte', label: 'Contexte', anchor: 0, isDefault: true, fields: ['motif'] },
        { key: 'diagnostics', label: 'Diagnostics retenus', anchor: 0, isDefault: false, fields: ['diagnostic'] },
        { key: 'synthese', label: 'Synthèse', anchor: 1, isDefault: false, fields: ['synthese'] },
      ],
    };
    const groups = groupFieldsBySection(ux16Fields, [{ id: 'clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }], layout);
    expect(groups.map((group) => [group.key, group.label, group.fields.map((item) => item.fieldKey)])).toEqual([
      ['__common_group__:contexte', 'Contexte', ['motif']],
      ['__common_group__:diagnostics', 'Diagnostics retenus', ['diagnostic']],
      ['clinique', 'Clinique', ['tension']],
      ['__common_group__:synthese', 'Synthèse', ['synthese']],
    ]);
    expect(ux16Fields.every((item) => item.section === null || item.section === 'clinique')).toBe(true);
  });

  test('UX-16 : une variable commune creee apres coup rejoint la rubrique par defaut', () => {
    const layout = {
      fingerprint: 'fixture', locked: false, inUse: false, defaultKey: 'contexte',
      unassigned: ['ajoutee'], sections: [{ key: 'clinique', label: 'Clinique' }],
      groups: [
        { key: 'contexte', label: 'Contexte', anchor: 0, isDefault: true, fields: ['motif'] },
        { key: 'synthese', label: 'Synthèse', anchor: 1, isDefault: false, fields: ['synthese'] },
      ],
    };
    // `ajoutee` n'est dans aucune rubrique : le formulaire ne doit pas faire reapparaitre un
    // « Tronc commun » a cote des rubriques nommees, ni perdre la variable.
    const groups = groupFieldsBySection(
      [field('motif', null), field('ajoutee', null), field('synthese', null)],
      [{ id: 'clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }],
      layout,
    );
    expect(groups.map((group) => [group.label, group.fields.map((item) => item.fieldKey)])).toEqual([
      ['Contexte', ['motif', 'ajoutee']],
      ['Synthèse', ['synthese']],
    ]);
  });

  test('collapse and one-block navigation preserve answers and the missing required field', async () => {
    render(<I18nProvider><Example /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('a'), { target: { value: '4' } });
    expect(screen.getByLabelText('Un bloc à la fois')).toBeChecked();
    expect(screen.getByLabelText('b')).not.toBeVisible();
    await userEvent.click(screen.getByLabelText('Un bloc à la fois'));
    await userEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
    expect(screen.getByText('1 champs requis renseignés sur 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Prochain champ obligatoire manquant' }));
    await waitFor(() => expect(screen.getByLabelText('b')).toHaveFocus());
    await userEvent.click(screen.getByLabelText('Un bloc à la fois'));
    await userEvent.click(screen.getByRole('button', { name: 'Bloc précédent' }));
    expect(screen.getByLabelText('a')).toHaveValue(4);
  });
  test('an error summary opens a collapsed block and exposes its associated error, which disappears after correction', async () => {
    render(<I18nProvider><Example /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('a'), { target: { value: '4' } });
    await userEvent.click(screen.getByLabelText('Un bloc à la fois'));
    await userEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    const summary = screen.getByRole('region', { name: 'Erreurs à corriger' });
    await userEvent.click(within(summary).getByRole('link', { name: 'b' }));
    await waitFor(() => expect(screen.getByLabelText('b')).toHaveFocus());
    expect(screen.getByLabelText('b')).toHaveAccessibleDescription('Champ obligatoire');
    expect(screen.getByLabelText('b')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('b'), { target: { value: '3' } });
    expect(screen.queryByRole('region', { name: 'Erreurs à corriger' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('b')).not.toHaveAttribute('aria-invalid');
  });
  test('a field chosen in the error summary wins over the deferred focus of the summary itself', async () => {
    // Le recapitulatif et le bloc revele partagent un seul creneau de focus differe. On laisse
    // les deux demandes en attente, puis on les declenche : la plus recente — le champ choisi
    // dans le recapitulatif — doit l emporter, sinon le focus reste sur le recapitulatif.
    let handle = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { frames.set(++handle, run); return handle; });
    vi.stubGlobal('cancelAnimationFrame', (pending: number) => { frames.delete(pending); });
    const flush = () => { const due = [...frames.entries()].sort((x, y) => x[0] - y[0]); frames.clear(); due.forEach(([, run]) => run(0)); };
    try {
      render(<I18nProvider><Example /></I18nProvider>);
      fireEvent.change(screen.getByLabelText('a'), { target: { value: '4' } });
      await userEvent.click(screen.getByLabelText('Un bloc à la fois'));
      await userEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
      flush();
      await userEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
      await userEvent.click(within(screen.getByRole('region', { name: 'Erreurs à corriger' })).getByRole('link', { name: 'b' }));
      flush();
      expect(screen.getByLabelText('b')).toHaveFocus();
    } finally { vi.unstubAllGlobals(); }
  });
  test('identity is the first presentation block and stays mounted across navigation and native validation', async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<I18nProvider><form onSubmit={submit}><SectionedFields fields={[fields[0]]}
      leadingBlock={{ label: 'Identité', content: <label>Code<input required /></label> }}
      renderField={() => <label>Valeur clinique<input /></label>} />
      <button type="submit">Enregistrer</button></form></I18nProvider>);
    const code = screen.getByLabelText('Code');
    const value = screen.getByLabelText('Valeur clinique');
    expect(code).toBeVisible(); expect(value).not.toBeVisible();
    await userEvent.type(code, 'P-FICTIF');
    await userEvent.click(screen.getByRole('button', { name: 'Bloc suivant' }));
    expect(code).not.toBeVisible(); expect(value).toBeVisible();
    await userEvent.type(value, 'Saisie conservée');
    await userEvent.click(screen.getByRole('button', { name: 'Bloc précédent' }));
    expect(code).toHaveValue('P-FICTIF');
    await userEvent.clear(code);
    await userEvent.click(screen.getByRole('button', { name: 'Bloc suivant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toBeVisible(); expect(value).toHaveValue('Saisie conservée');
    expect(screen.getByRole('alert')).toHaveTextContent('Code');
    expect(submit).not.toHaveBeenCalled();
  });
  test('the deferred focus of a block never takes back a field the user has just chosen', async () => {
    // Le focus du bloc revele est differe d une frame. On la fait tomber APRES que
    // l utilisateur a choisi son champ : la reprendre lui ferait perdre sa frappe.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames[handle - 1] = () => {}; });
    try {
      render(<I18nProvider><SectionedFields fields={[fields[0]]}
        leadingBlock={{ label: 'Identité', content: <label>Code<input /></label> }}
        renderField={() => <label>Valeur clinique<input /></label>} /></I18nProvider>);
      const value = screen.getByLabelText('Valeur clinique');
      await userEvent.click(screen.getByRole('button', { name: 'Bloc suivant' }));
      await userEvent.click(value);
      frames.splice(0).forEach((run) => run(0));
      await userEvent.keyboard('Saisie conservée');
      expect(value).toHaveFocus(); expect(value).toHaveValue('Saisie conservée');
    } finally { vi.unstubAllGlobals(); }
  });
  test('counts follow visibility, permitted missing codes, conditional obligations and invalid values', () => {
    const conditionalFields = [field('a', null), { ...field('b', 'clinique', true), allowMissingCodes: true }];
    const first = calculateFormProgress(conditionalFields, { a: 2, b: makeMissing('inconnu') }, [required], new Set(), true);
    expect(first.filledRequired).toBe(1); expect(first.issues).toHaveLength(0);
    const conditional = calculateFormProgress(conditionalFields, { a: 1, b: makeMissing('inconnu') }, [required], new Set(), true);
    expect(conditional.missingKeys).toEqual(['b']); expect(conditional.issues).toEqual([{ fieldKey: 'b', message: required.message }]);
    const invalid = calculateFormProgress(conditionalFields, { b: 50 }, [], new Set(), true);
    expect(invalid.filledRequired).toBe(1); expect(invalid.issues[0].message).toMatch(/maximale/);
    const invisible = calculateFormProgress(conditionalFields, { b: 50 }, [], new Set(['b']), true);
    expect(invisible.requiredKeys.size).toBe(0); expect(invisible.issues).toHaveLength(0);
    expect(calculateFormProgress([], {}).filledRequired).toBe(0);
  });
  test('temporarily inapplicable values do not feed progress and reappear when applicable again', () => {
    const visibility: ValidationRule = { ...required, rule: { if: { field: 'a', operator: 'equals', value: 1 }, then: { field: 'b', operator: 'visible' } } };
    const values = { a: 2, b: 8 };
    const hidden = hiddenFieldKeys([visibility], values, fields);
    expect(hidden.has('b')).toBe(true);
    expect(calculateFormProgress(fields, values, [visibility], hidden).requiredKeys.size).toBe(1);
    expect(hiddenFieldKeys([visibility], { ...values, a: 1 }, fields).has('b')).toBe(false);
    expect(values.b).toBe(8);
  });
});
