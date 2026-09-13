// @vitest-environment jsdom
//
// L60 — §9.2 de docs/spec-blocs-reutilisables.md, point par point : proposition affichée
// seulement si TOUTES les compatibilités sont réunies ; release terminologique différente
// refusée avec le motif exact ; code absent de la release refusé ; création de la règle par
// le chemin existant ; refus laissant le bloc visible sans condition.
//
// Le panneau est monté sur le vrai module de domaine : ces tests décrivent donc ce que
// l'utilisateur voit, et non ce que `activationProposal` renvoie. La matrice exhaustive des
// seize refus est vérifiée en plus, pour qu'aucun n'atterrisse sur un message vide.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import {
  ACTIVATION_BLOCKER_MESSAGE_KEY,
  type ImportedBlockActivation,
} from '../../domain/blockActivation';
import { messages } from '../../i18n/messages.fr';
import type {
  DiagnosisContext,
  TemplateField,
  TemplateSection,
  ValidationRule,
} from '../../data/types';
import { BlockActivationPanel } from './BlockActivationPanel';

const RELEASE = '11111111-1111-4111-8111-111111111111';
const AUTRE_RELEASE = '22222222-2222-4222-8222-222222222222';

const field = (
  { fieldKey, ...rest }: Partial<TemplateField> & Pick<TemplateField, 'fieldKey'>,
): TemplateField => ({
  id: fieldKey,
  fieldKey,
  label: fieldKey,
  scope: 'patient',
  section: null,
  type: 'terminology',
  isMultiple: true,
  unit: null,
  allowedValues: null,
  required: false,
  minValue: null,
  maxValue: null,
  allowMissingCodes: false,
  displayOrder: 0,
  ...rest,
});

/** Pilote diagnostique du tronc commun, identique dans la source et dans la cible. */
const DRIVER = field({ fieldKey: 'diagnostics', label: 'Diagnostics' });
/** Variable portée par le bloc importé : sans elle le bloc serait vide (L55). */
const CARRIED = field({ fieldKey: 'bk_crachats', label: 'BK crachats', section: 'tuberculose', type: 'text', isMultiple: false });

const SECTIONS: TemplateSection[] = [
  { id: 'tuberculose', sectionKey: 'tuberculose', label: 'Tuberculose', parentSectionKey: null, displayOrder: 0 },
];

const CONTEXT: DiagnosisContext[] = [{
  scope: 'patient',
  diagnosisFieldKey: 'diagnostics',
  terminologyReleaseId: RELEASE,
  commonOnlyCodes: ['Z00'],
  proposalFieldKey: 'diagnostics_autre',
  recognizedCodes: ['A15.0', 'A15.1', 'Z00'],
}];

const ACTIVATION: ImportedBlockActivation = {
  sectionKey: 'tuberculose',
  activation: { field: 'diagnostics', operator: 'contains_any', value: ['A15.0'], terminologyReleaseId: RELEASE },
  sourceDriver: DRIVER,
};

function renderPanel(over: {
  activation?: ImportedBlockActivation;
  fields?: TemplateField[];
  sections?: TemplateSection[];
  rules?: ValidationRule[];
  diagnosis?: DiagnosisContext[] | null;
} = {}) {
  const onCreate = vi.fn();
  render(
    <I18nProvider>
      <BlockActivationPanel
        activation={over.activation ?? ACTIVATION}
        fields={over.fields ?? [DRIVER, CARRIED]}
        sections={over.sections ?? SECTIONS}
        rules={over.rules ?? []}
        diagnosis={over.diagnosis === undefined ? CONTEXT : over.diagnosis}
        busy={false}
        onCreate={onCreate}
      />
    </I18nProvider>,
  );
  return { onCreate };
}

const createButton = () => screen.queryByRole('button', { name: /Créer cette règle/ });

describe('L60 — proposition de reconnexion', () => {
  test('propose la regle quand toutes les compatibilites sont reunies, et la montre en clair', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /Créer cette règle/ })).toBeEnabled();
    // La phrase de la règle est celle de la liste des règles : « en un geste » n'est pas
    // « à l'aveugle ». Elle nomme le pilote, les codes et le bloc conditionné.
    const summary = screen.getByText(/Tuberculose/);
    expect(summary).toHaveTextContent('Diagnostics');
    expect(summary).toHaveTextContent('A15.0');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('cree la regle PAR LE CHEMIN EXISTANT, sous la forme exacte attendue par le moteur', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderPanel();
    await user.click(await screen.findByRole('button', { name: /Créer cette règle/ }));
    // Le panneau n'écrit rien lui-même : il rend la règle à l'éditeur, qui appelle `addRule`.
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      if: { field: 'diagnostics', operator: 'contains_any', value: ['A15.0'], terminologyReleaseId: RELEASE },
      then: { section: 'tuberculose', operator: 'visible' },
    });
  });

  test('release terminologique differente : refus avec le motif exact, pas un message generique', async () => {
    renderPanel({
      activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, terminologyReleaseId: AUTRE_RELEASE } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(messages['blockactivation.blocked.release_mismatch']);
    expect(createButton()).toBeNull();
  });

  test('code absent de la release : refus nommant le code fautif', async () => {
    renderPanel({
      activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, value: ['A15.0', 'B99.9'] } },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('B99.9');
    // Le code présent dans la release n'est pas dénoncé : seul le fautif est nommé.
    expect(alert).not.toHaveTextContent('A15.0');
    expect(createButton()).toBeNull();
  });

  test('aucune configuration diagnostique sur la cible : l edition n est verifiable nulle part', async () => {
    renderPanel({ diagnosis: null });
    expect(await screen.findByRole('alert')).toHaveTextContent(messages['blockactivation.blocked.release_unknown']);
    expect(createButton()).toBeNull();
  });

  test('un refus laisse le bloc visible sans condition et renvoie au constructeur', async () => {
    const { onCreate } = renderPanel({ fields: [CARRIED] });
    expect(await screen.findByRole('alert')).toHaveTextContent(messages['blockactivation.blocked.driver_missing']);
    // Rien n'est proposé, rien n'est écrit, et l'écran dit ce qu'il advient du bloc.
    expect(createButton()).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(messages['blockactivation.fallback'])).toBeInTheDocument();
  });

  test('bloc deja conditionne ou source sans condition : rien a reconnecter, panneau absent', () => {
    const porte: ValidationRule[] = [{
      id: 'r1',
      rule: { if: { field: 'diagnostics', operator: 'contains_any', value: ['A15.1'], terminologyReleaseId: RELEASE },
        then: { section: 'tuberculose', operator: 'visible' } },
      message: null,
      severity: 'block',
    }];
    const { container } = render(
      <I18nProvider>
        <BlockActivationPanel activation={ACTIVATION} fields={[DRIVER, CARRIED]} sections={SECTIONS}
          rules={porte} diagnosis={CONTEXT} busy={false} onCreate={vi.fn()} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();

    const { container: sansRegle } = render(
      <I18nProvider>
        <BlockActivationPanel activation={{ ...ACTIVATION, activation: null }} fields={[DRIVER, CARRIED]}
          sections={SECTIONS} rules={[]} diagnosis={CONTEXT} busy={false} onCreate={vi.fn()} />
      </I18nProvider>,
    );
    expect(sansRegle).toBeEmptyDOMElement();
  });
});

describe('L60 — chaque condition manquante a son propre motif', () => {
  // Un cas par refus : sans cela, un code ajouté plus tard retomberait silencieusement sur le
  // premier message venu, et l'écran redeviendrait générique là où le §6 exige un motif.
  const cases: { code: keyof typeof ACTIVATION_BLOCKER_MESSAGE_KEY; build: () => Parameters<typeof renderPanel>[0] }[] = [
    { code: 'driver_missing', build: () => ({ fields: [CARRIED] }) },
    { code: 'driver_scope', build: () => ({ fields: [field({ fieldKey: 'diagnostics', scope: 'encounter' }), CARRIED] }) },
    { code: 'driver_type', build: () => ({ fields: [field({ fieldKey: 'diagnostics', type: 'multiselect' }), CARRIED] }) },
    { code: 'driver_multiple', build: () => ({ fields: [field({ fieldKey: 'diagnostics', isMultiple: false }), CARRIED] }) },
    { code: 'driver_in_block', build: () => ({ fields: [field({ fieldKey: 'diagnostics', section: 'autre_bloc' }), CARRIED] }) },
    { code: 'driver_calculated', build: () => ({ fields: [field({ fieldKey: 'diagnostics', formula: 'a - b' }), CARRIED] }) },
    {
      code: 'driver_hidden',
      build: () => ({
        rules: [{ id: 'h', rule: { if: { field: 'bk_crachats', operator: 'equals', value: 'x' }, then: { field: 'diagnostics', operator: 'visible' } }, message: null, severity: 'block' }],
      }),
    },
    { code: 'release_unknown', build: () => ({ diagnosis: null }) },
    {
      code: 'release_mismatch',
      build: () => ({ activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, terminologyReleaseId: AUTRE_RELEASE } } }),
    },
    {
      code: 'code_unknown',
      build: () => ({ activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, value: ['X99'] } } }),
    },
    {
      code: 'common_only',
      build: () => ({ activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, value: ['Z00'] } } }),
    },
    {
      code: 'diagnosis_noncanonical',
      build: () => ({
        activation: {
          ...ACTIVATION,
          activation: { field: 'diagnostics', operator: 'equals', value: 'A15.0' },
        },
      }),
    },
    {
      code: 'block_scope',
      build: () => ({ fields: [DRIVER, field({ fieldKey: 'bk_crachats', section: 'tuberculose', type: 'text', isMultiple: false, scope: 'encounter' })] }),
    },
    {
      code: 'block_empty',
      build: () => ({ fields: [DRIVER, field({ fieldKey: 'bk_crachats', section: 'tuberculose', type: 'number', isMultiple: false, formula: 'a - b' })] }),
    },
    {
      code: 'invalid',
      build: () => ({ activation: { ...ACTIVATION, activation: { ...ACTIVATION.activation!, value: [] } } }),
    },
  ];

  test('tous les refus declares sont couverts, sans trou dans la table de messages', () => {
    expect(new Set(cases.map((c) => c.code)).size).toBe(Object.keys(ACTIVATION_BLOCKER_MESSAGE_KEY).length);
  });

  test.each(cases)('refus $code', async ({ code, build }) => {
    renderPanel(build());
    const alert = await screen.findByRole('alert');
    const expected = messages[ACTIVATION_BLOCKER_MESSAGE_KEY[code]];
    // Comparaison sur le début du message : le complément factuel varie, le motif non.
    expect(alert.textContent ?? '').toContain(expected.split('{')[0].trim().slice(0, 40));
    expect(createButton()).toBeNull();
  });
});
