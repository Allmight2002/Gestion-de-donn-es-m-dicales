// @vitest-environment jsdom
//
// L59 — §9.2 de docs/spec-blocs-reutilisables.md, point par point : catalogue filtré,
// aperçu fidèle, conflits rendus clé par clé, réutilisation proposée seulement quand le
// serveur l'a jugée compatible, avertissement `required` affiché quand et seulement quand il
// s'applique, aucune écriture avant confirmation, les douze messages de refus, l'état de
// chargement et le double clic. Plus les deux cas exigés en supplément : le catalogue vide et
// la version non éditable (celui-ci dans TemplateVersionEditor.test.tsx, où vit la commande).
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TemplateRepository } from '../../data/templates';
import type {
  ImportableBlock,
  SectionImportConflict,
  SectionImportRefusalCode,
  SectionImportReport,
  TemplateField,
} from '../../data/types';
import { IMPORT_REFUSAL_MESSAGE_KEY } from '../../domain/templateSectionImport';
import { messages } from '../../i18n/messages.fr';
import { SectionImportDialog } from './SectionImportDialog';

const TARGET = 'version-cible';

const block = (over: Partial<ImportableBlock> = {}): ImportableBlock => ({
  templateId: 'gabarit-source',
  templateName: 'Pneumologie',
  isGlobal: false,
  versionId: 'version-source',
  versionNumber: 2,
  versionStatus: 'draft',
  sectionKey: 'tuberculose',
  label: 'Tuberculose',
  displayOrder: 0,
  subsectionCount: 2,
  fieldCount: 4,
  ...over,
});

const field = ({ fieldKey, label, ...rest }: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label'>): TemplateField => ({
  id: fieldKey,
  fieldKey,
  label,
  scope: 'patient',
  section: 'tuberculose',
  type: 'text',
  unit: null,
  allowedValues: null,
  required: false,
  minValue: null,
  maxValue: null,
  allowMissingCodes: false,
  displayOrder: 0,
  ...rest,
});

const report = (over: Partial<SectionImportReport> = {}): SectionImportReport => ({
  sectionKey: 'tuberculose',
  subsections: ['clinique', 'biologie'],
  importedFields: ['bk_crachats', 'toux'],
  reusedFields: [],
  copiedRules: 3,
  activationRule: { field: 'diagnostic', operator: 'contains_any', value: ['A15.0'] },
  conflicts: [],
  ...over,
});

const SOURCE_FIELDS = [
  field({ fieldKey: 'bk_crachats', label: 'BK crachats' }),
  field({ fieldKey: 'toux', label: 'Toux', type: 'boolean' }),
  field({ fieldKey: 'diagnostic', label: 'Diagnostic', section: null }),
];

/** Refus typé tel qu'il traverse PostgREST : le code vit dans `details`, jamais dans le message. */
const refusal = (code: SectionImportRefusalCode) => Object.assign(
  new Error('Import de bloc refuse.'),
  { code: 'P0001', details: JSON.stringify({ code }) },
);

function makeRepo(over: Partial<TemplateRepository> = {}, blocks: ImportableBlock[] = [block()]) {
  const listImportableSections = vi.fn(async () => blocks);
  const previewSectionImport = vi.fn(async () => report());
  const importSection = vi.fn(async () => report());
  const getFields = vi.fn(async () => SOURCE_FIELDS);
  return {
    listImportableSections, previewSectionImport, importSection, getFields,
    getVersion: vi.fn(async () => ({ version: {}, fields: SOURCE_FIELDS, rules: [], sections: [] })),
    ...over,
  } as unknown as TemplateRepository;
}

function renderDialog(repo: TemplateRepository, over: Partial<Parameters<typeof SectionImportDialog>[0]> = {}) {
  const onImported = vi.fn();
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <SectionImportDialog
        repo={repo}
        targetVersionId={TARGET}
        onClose={onClose}
        onImported={onImported}
        onActivate={onActivate}
        {...over}
      />
    </I18nProvider>,
  );
  return { onImported, onActivate, onClose };
}

/** Choisit le premier bloc du catalogue et attend l'aperçu. */
async function chooseFirstBlock(user: ReturnType<typeof userEvent.setup>, value = 'version-source::tuberculose') {
  const select = await screen.findByLabelText(/Bloc à importer/);
  await user.selectOptions(select, value);
  await screen.findByText(/Ce qui sera écrit/);
}

describe('SectionImportDialog', () => {
  test('liste les blocs lisibles et retire la version cible, qui echouerait toujours', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({}, [
      block(),
      block({ versionId: 'version-globale', templateName: 'Modele standard', isGlobal: true, sectionKey: 'covid', label: 'COVID', fieldCount: 7, subsectionCount: 0 }),
      // Un bloc de la version CIBLE : le proposer serait un piège (`IMPORT_SECTION_EXISTS`).
      block({ versionId: TARGET, sectionKey: 'deja_la', label: 'Déjà là' }),
    ]);
    renderDialog(repo);

    const select = await screen.findByLabelText(/Bloc à importer/);
    expect(within(select).getByRole('option', { name: /Tuberculose/ })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /COVID · 7 variable/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /Déjà là/ })).not.toBeInTheDocument();

    // Le modèle global est annoncé comme tel : c'est une source légitime (D4).
    expect(within(select).getByRole('group', { name: /Modele standard · Version 2 \(modèle global\)/ })).toBeInTheDocument();
    // Aucune écriture n'a eu lieu du seul fait d'ouvrir le panneau.
    expect(repo.importSection).not.toHaveBeenCalled();
    await user.click(document.body);
  });

  test('catalogue vide : un etat explicite, pas un ecran blanc', async () => {
    renderDialog(makeRepo({}, []));
    expect(await screen.findByText(/Aucun bloc à importer pour l’instant/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bloc à importer/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer ce bloc' })).toBeDisabled();
  });

  test('apercu fidele : variables, sous-sections, regles internes et regle d activation non copiee', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderDialog(repo);
    await chooseFirstBlock(user);

    expect(repo.previewSectionImport).toHaveBeenCalledWith('version-source', 'tuberculose', TARGET, []);
    expect(screen.getByText('BK crachats')).toBeInTheDocument();
    expect(screen.getByText('Toux')).toBeInTheDocument();
    // Le pilote du tronc commun de la source n'est pas importé : il n'est pas dans le bloc.
    expect(screen.queryByText('Diagnostic')).not.toBeInTheDocument();
    expect(screen.getByText(/Sous-sections : clinique, biologie/)).toBeInTheDocument();
    expect(screen.getByText(/3 règle\(s\) interne\(s\)/)).toBeInTheDocument();
    // D7 : la règle d'activation est décrite, jamais copiée — et l'écran le dit avant l'écriture.
    expect(screen.getByText(/n’est PAS copiée/)).toBeInTheDocument();
    expect(screen.getByText(/« Diagnostic »/)).toBeInTheDocument();
    expect(repo.importSection).not.toHaveBeenCalled();
  });

  test('avertissement required affiche quand et seulement quand il s applique', async () => {
    const user = userEvent.setup();
    renderDialog(makeRepo());
    await chooseFirstBlock(user);
    // Aucune variable obligatoire dans le bloc : l'avertissement serait un bruit qu'on
    // finirait par ne plus lire le jour ou il compte vraiment.
    expect(screen.queryByText(/POUR TOUS LES PATIENTS/)).not.toBeInTheDocument();
  });

  test('avertissement required affiche des qu une variable obligatoire est importee', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({
      getFields: vi.fn(async () => [
        field({ fieldKey: 'bk_crachats', label: 'BK crachats', required: true }),
        field({ fieldKey: 'toux', label: 'Toux', type: 'boolean' }),
        // Obligatoire mais RÉUTILISÉE : elle existe déjà dans la cible et n'est pas réécrite.
        field({ fieldKey: 'poids', label: 'Poids', type: 'number', required: true }),
      ]),
      previewSectionImport: vi.fn(async () => report({ reusedFields: ['poids'] })),
    } as Partial<TemplateRepository>);
    renderDialog(repo);
    await chooseFirstBlock(user);

    const warning = await screen.findByText(/POUR TOUS LES PATIENTS/);
    expect(warning).toHaveTextContent('1 variable(s)');
    expect(warning).toHaveTextContent('BK crachats');
    expect(warning).not.toHaveTextContent('Poids');
  });

  test('conflits rendus cle par cle ; la reutilisation n est proposee que si le serveur l a jugee possible', async () => {
    const user = userEvent.setup();
    const conflicts: SectionImportConflict[] = [
      { code: 'IMPORT_FIELD_CONFLICT', fieldKey: 'poids', existingSection: null, reusable: true },
      { code: 'IMPORT_REUSE_IN_BLOCK', fieldKey: 'toux', existingSection: 'cardio', reusable: false },
    ];
    const previewSectionImport = vi.fn(async (_s: string, _k: string, _t: string, reuse: string[] = []) =>
      (reuse.includes('poids') ? report({ reusedFields: ['poids'] }) : report({ conflicts })));
    const repo = makeRepo({ previewSectionImport } as Partial<TemplateRepository>);
    renderDialog(repo);
    await chooseFirstBlock(user);

    // Chaque clé est nommée, avec l'endroit où vit la variable et le motif du refus. Les
    // assertions restent dans le panneau des conflits : une clé apparaît aussi dans la
    // liste des variables de l'aperçu, et confondre les deux ne prouverait rien.
    const panel = within((await screen.findByRole('heading', { name: /Conflits à régler/ })).closest('section')!);
    expect(panel.getByText('poids')).toBeInTheDocument();
    expect(panel.getByText(/Variable existante : tronc commun/)).toBeInTheDocument();
    expect(panel.getByText('toux')).toBeInTheDocument();
    expect(panel.getByText(/Variable existante : bloc « cardio »/)).toBeInTheDocument();
    expect(panel.getByText(/appartient à un autre bloc/)).toBeInTheDocument();
    // Jamais de renommage automatique : c'est dit, et rien ne le propose.
    expect(panel.getByText(/Aucun code n’est renommé automatiquement/)).toBeInTheDocument();

    // Une seule proposition, pour la seule clé que le serveur a marquée réutilisable.
    const proposals = panel.getAllByRole('checkbox', { name: 'Réutiliser la variable déjà présente' });
    expect(proposals).toHaveLength(1);
    // Tant qu'un conflit subsiste, l'import reste fermé.
    expect(screen.getByRole('button', { name: 'Importer ce bloc' })).toBeDisabled();

    await user.click(proposals[0]);
    await waitFor(() => expect(previewSectionImport).toHaveBeenLastCalledWith('version-source', 'tuberculose', TARGET, ['poids']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importer ce bloc' })).toBeEnabled());
    expect(repo.importSection).not.toHaveBeenCalled();
  });

  test('un conflit de formule nomme l operande, sans inventer ou vit la variable', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({
      previewSectionImport: vi.fn(async () => report({
        conflicts: [{
          code: 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE', fieldKey: 'duree', existingSection: null,
          reusable: false, operandKey: 'date_debut',
        }],
      })),
    } as Partial<TemplateRepository>);
    renderDialog(repo);
    await chooseFirstBlock(user);

    const panel = within((await screen.findByRole('heading', { name: /Conflits à régler/ })).closest('section')!);
    expect(panel.getByText('duree')).toBeInTheDocument();
    expect(panel.getByText(/Élément du calcul en cause : date_debut/)).toBeInTheDocument();
    // Le rapport laisse `existingSection` a null pour un conflit de formule, quel que soit
    // l'endroit ou vit l'operande : l'ecran ne doit donc affirmer aucun emplacement.
    expect(panel.queryByText(/Variable existante/)).not.toBeInTheDocument();
  });

  test('un double clic ne produit jamais deux imports', async () => {
    const user = userEvent.setup();
    let release: (value: SectionImportReport) => void = () => {};
    const importSection = vi.fn(() => new Promise<SectionImportReport>((resolve) => { release = resolve; }));
    const repo = makeRepo({ importSection } as unknown as Partial<TemplateRepository>);
    const { onImported } = renderDialog(repo);
    await chooseFirstBlock(user);

    const confirm = screen.getByRole('button', { name: 'Importer ce bloc' });
    await user.click(confirm);
    await user.click(confirm);
    expect(importSection).toHaveBeenCalledTimes(1);
    // Etat de chargement visible pendant l'aller-retour.
    expect(await screen.findByRole('button', { name: 'Import en cours…' })).toBeDisabled();

    release(report());
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  test('apres succes : compte rendu du rapport et passage a l activation propose', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({
      importSection: vi.fn(async () => report({ reusedFields: ['poids'] })),
    } as Partial<TemplateRepository>);
    const { onActivate, onImported } = renderDialog(repo);
    await chooseFirstBlock(user);
    await user.click(screen.getByRole('button', { name: 'Importer ce bloc' }));

    const summary = await screen.findByText(/« tuberculose » a été ajouté en fin de version/);
    expect(summary).toHaveTextContent('2 variable(s) créée(s)');
    expect(summary).toHaveTextContent('1 réutilisée(s)');
    expect(summary).toHaveTextContent('3 règle(s) interne(s)');
    expect(summary).toHaveTextContent('2 sous-section(s)');
    expect(onImported).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Conditionner ce bloc' }));
    // L60 : la condition d'origine et son pilote SOURCE partent avec le bloc. Sans le pilote,
    // la cible n'aurait rien contre quoi comparer le type, la portée et le caractère multiple.
    expect(onActivate).toHaveBeenCalledWith({
      sectionKey: 'tuberculose',
      activation: { field: 'diagnostic', operator: 'contains_any', value: ['A15.0'] },
      sourceDriver: SOURCE_FIELDS.find((f) => f.fieldKey === 'diagnostic'),
    });
  });

  test('les douze refus de L58 ont chacun leur message', async () => {
    const codes = Object.keys(IMPORT_REFUSAL_MESSAGE_KEY) as SectionImportRefusalCode[];
    expect(codes).toHaveLength(12);

    for (const code of codes) {
      const user = userEvent.setup();
      const repo = makeRepo({
        importSection: vi.fn(async () => { throw refusal(code); }),
      } as Partial<TemplateRepository>);
      const view = render(
        <I18nProvider>
          <SectionImportDialog repo={repo} targetVersionId={TARGET} onClose={() => {}} onImported={() => {}} onActivate={() => {}} />
        </I18nProvider>,
      );
      await chooseFirstBlock(user);
      await user.click(screen.getByRole('button', { name: 'Importer ce bloc' }));

      const expected = messages[IMPORT_REFUSAL_MESSAGE_KEY[code]];
      expect(expected.length).toBeGreaterThan(20);
      expect((await screen.findByRole('alert')).textContent).toBe(expected);
      view.unmount();
    }
  });

  test('une panne non typee retombe sur le message generique, sans motif metier invente', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({
      importSection: vi.fn(async () => { throw new Error('Failed to fetch'); }),
    } as Partial<TemplateRepository>);
    renderDialog(repo);
    await chooseFirstBlock(user);
    await user.click(screen.getByRole('button', { name: 'Importer ce bloc' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
  });
});
