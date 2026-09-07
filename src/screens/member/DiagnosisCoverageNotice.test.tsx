// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { DiagnosisContext, TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { DiagnosisCoverageNotice, diagnosisCoverageOrNull } from './DiagnosisCoverageNotice';

const context: DiagnosisContext[] = [{
  scope: 'patient',
  diagnosisFieldKey: 'diagnostics',
  terminologyReleaseId: null,
  commonOnlyCodes: ['B'],
  proposalFieldKey: 'diagnostics_autre',
  recognizedCodes: ['A', 'B', 'C'],
}];

const fields = [
  { id: 'f1', fieldKey: 'diagnostics', label: 'Diagnostics', scope: 'patient', section: null, type: 'multiselect', displayOrder: 0 },
  { id: 'f2', fieldKey: 'diagnostics_autre', label: 'Proposition', scope: 'patient', section: null, type: 'text', displayOrder: 1 },
  { id: 'f3', fieldKey: 'mesure', label: 'Mesure', scope: 'patient', section: 'bloc', type: 'text', displayOrder: 2 },
] as unknown as TemplateField[];

const sections = [{ id: 's1', sectionKey: 'bloc', label: 'Bloc', parentSectionKey: null }] as unknown as TemplateSection[];
const rules = [{
  rule: { if: { field: 'diagnostics', operator: 'contains_any', value: ['A'] }, then: { section: 'bloc', operator: 'visible' } },
}] as unknown as ValidationRule[];

const coverageOf = (values: Record<string, unknown>, ctx: DiagnosisContext[] | undefined = context) =>
  diagnosisCoverageOrNull('v1', ctx, 'patient', values, fields, rules, sections);

const renderNotice = (values: Record<string, unknown>) =>
  render(<I18nProvider><DiagnosisCoverageNotice coverage={coverageOf(values)} /></I18nProvider>);

describe('DiagnosisCoverageNotice (L56)', () => {
  test('reste muette quand chaque diagnostic est couvert ou declare suffisant', async () => {
    const { container } = renderNotice({ diagnostics: ['A', 'B'] });
    expect(container).toBeEmptyDOMElement();
  });

  test('annonce les codes sans bloc sans jamais bloquer la saisie', async () => {
    renderNotice({ diagnostics: ['A', 'C'] });
    expect(await screen.findByRole('status')).toHaveTextContent('1 diagnostic(s) sans bloc spécialisé');
    expect(screen.getByRole('status')).toHaveTextContent('C');
    expect(screen.getByRole('status')).toHaveTextContent('Information seulement');
    // Une information : ni bouton, ni champ, ni alerte.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('signale une proposition non rattachee SANS en citer le texte', async () => {
    renderNotice({ diagnostics_autre: 'Diagnostic fictif hors liste' });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('pas encore rattachée à un code');
    expect(notice.textContent).not.toContain('Diagnostic fictif hors liste');
  });

  test('configuration absente ou irresoluble : aucun calcul, aucune information', () => {
    // Serveur qui ignore la colonne (undefined) et serveur L55 sans configuration ([]) :
    // dans les deux cas, comportement historique, aucune information affichee.
    expect(diagnosisCoverageOrNull(
      'v1', undefined, 'patient', { diagnostics: ['C'] }, fields, rules, sections,
    )).toBeNull();
    expect(coverageOf({ diagnostics: ['C'] }, [])).toBeNull();
    // Pilote introuvable dans le dictionnaire fourni : la saisie continue, sans message.
    expect(diagnosisCoverageOrNull(
      'v1', context, 'patient', { diagnostics: ['C'] }, [], rules, sections,
    )).toBeNull();
  });

  test('une valeur hors referentiel n est jamais convertie en faux diagnostic', () => {
    expect(coverageOf({ diagnostics: ['ZZ'] })!.counts)
      .toEqual({ covered: 0, common_only: 0, uncovered: 0, unclassified: 0 });
  });
});
