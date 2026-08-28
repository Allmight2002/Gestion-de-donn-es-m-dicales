// @vitest-environment jsdom
// L29 — apercu du formulaire. Deux exigences sont verifiees ici :
//  1. l'apercu rend le formulaire REEL (memes composants de saisie, meme filtre par type) ;
//  2. il n'ecrit RIEN — ni depot, ni brouillon local, ni requete reseau.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateField, TemplateVersion, ValidationRule } from '../../data/types';
import { FormPreview } from './FormPreview';

const version: TemplateVersion = { id: 'v1', templateId: 't1', versionNumber: 3, status: 'draft' };

const field = (over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label'>): TemplateField => ({
  scope: 'encounter', section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  ...over,
});

const fields: TemplateField[] = [
  field({ id: 'f1', fieldKey: 'antecedents', label: 'Antécédents', scope: 'patient', displayOrder: 1 }),
  field({ id: 'f2', fieldKey: 'glasgow', label: 'Score de Glasgow', type: 'integer', required: true, minValue: 3, maxValue: 15, displayOrder: 2 }),
  field({ id: 'f3', fieldKey: 'motif_admission', label: 'Motif d’admission', encounterTypes: ['hospitalisation'], displayOrder: 3 }),
  field({ id: 'f4', fieldKey: 'diagnostic', label: 'Diagnostic', type: 'terminology', displayOrder: 4 }),
];

const rules: ValidationRule[] = [];

const renderPreview = () => render(
  <I18nProvider>
    <FormPreview version={version} fields={fields} rules={rules} onClose={() => undefined} />
  </I18nProvider>,
);

describe('FormPreview — fidélité au formulaire réel', () => {
  test('rend les variables de rencontre et suit le type choisi', async () => {
    renderPreview();
    // Type par defaut « consultation » : la variable reservee a l'hospitalisation ne doit
    // pas apparaitre, exactement comme dans EncounterForm.
    expect(screen.getByLabelText('Score de Glasgow')).toBeInTheDocument();
    expect(screen.queryByLabelText('Motif d’admission')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Type de rencontre'), 'hospitalisation');
    expect(screen.getByLabelText('Motif d’admission')).toBeInTheDocument();
  });

  test('l’onglet fiche patient rend les variables permanentes, sans code de valeur manquante', async () => {
    renderPreview();
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));
    expect(screen.getByLabelText('Antécédents')).toBeInTheDocument();
    // Les donnees permanentes passent par FieldInput (cf. NewPatient), pas par ValueInput :
    // aucun selecteur « valeur manquante » ne doit apparaitre.
    expect(screen.queryByLabelText(/valeur manquante/)).toBeNull();
  });

  test('la vue mobile contraint la largeur du rendu', async () => {
    const { container } = renderPreview();
    expect(container.querySelector('[data-viewport="desktop"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    const frame = container.querySelector('[data-viewport="mobile"]') as HTMLElement | null;
    expect(frame).not.toBeNull();
    expect(frame!.style.width).toBe('390px');
    // Les deux vues rendent le meme formulaire, avec les memes composants de saisie.
    expect(within(frame!).getByLabelText('Score de Glasgow')).toBeInTheDocument();
  });

  test('les contrôles du formulaire sont rejoués à la demande', async () => {
    renderPreview();
    // Statut « finalisé » : c'est la frontiere ou EncounterForm exige la completude.
    await userEvent.selectOptions(screen.getByLabelText('Statut du dossier'), 'curated');
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Score de Glasgow');

    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2026-08-14' } });
    await userEvent.type(screen.getByLabelText('Score de Glasgow'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Aucun blocage ni avertissement avec ces valeurs.')).toBeInTheDocument();
  });
});

describe('FormPreview — aucune écriture', () => {
  const appels: string[] = [];
  let fetchSpy: ReturnType<typeof vi.fn>;

  // Chaque depot de l'application est remplace par un mandataire qui note et rejette tout
  // appel : si l'apercu touchait la moindre methode d'un depot reel, le test le dirait.
  // Seule exception attendue : le depot de terminologie INERTE que l'apercu injecte
  // lui-meme, plus pres du composant, et qui masque donc celui de ce test.
  const interdit = (nom: string) => new Proxy({}, {
    get: (_cible, prop) => {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (...args: unknown[]) => {
        appels.push(`${nom}.${String(prop)}(${args.length})`);
        throw new Error(`Appel interdit depuis l’aperçu : ${nom}.${String(prop)}`);
      };
    },
  }) as never;

  beforeEach(() => {
    appels.length = 0;
    localStorage.clear();
    fetchSpy = vi.fn(() => Promise.reject(new Error('réseau interdit depuis l’aperçu')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('ni dépôt appelé, ni brouillon local, ni requête réseau', async () => {
    render(
      <I18nProvider>
        <RepositoryProvider
          templates={interdit('templates')} bases={interdit('bases')} patients={interdit('patients')}
          attachments={interdit('attachments')} cohorts={interdit('cohorts')} exports={interdit('exports')}
          access={interdit('access')} curation={interdit('curation')} admin={interdit('admin')}
          audit={interdit('audit')} groups={interdit('groups')} terminology={interdit('terminology')}
          missions={interdit('missions')} clientErrors={interdit('clientErrors')}
        >
          <FormPreview version={version} fields={fields} rules={rules} onClose={() => undefined} />
        </RepositoryProvider>
      </I18nProvider>,
    );

    // Un parcours complet : saisir, changer de type, de vue, d'onglet, rejouer les
    // controles — tout ce qu'un utilisateur peut declencher depuis cet ecran.
    await userEvent.type(screen.getByLabelText('Score de Glasgow'), '12');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2026-08-14' } });
    await userEvent.type(screen.getByLabelText('Diagnostic'), 'hema');
    // Le champ diagnostic a bien cherche — et c'est le depot INERTE qui a repondu, sans rien
    // ramener ni rien telecharger.
    expect(await screen.findByText('Aucun diagnostic trouvé pour cette recherche.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type de rencontre'), 'hospitalisation');
    await userEvent.type(screen.getByLabelText('Motif d’admission'), 'traumatisme');
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tester les contrôles' }));
    await userEvent.click(screen.getByRole('tab', { name: /Fiche patient/ }));
    await userEvent.type(screen.getByLabelText('Antécédents'), 'HTA');

    expect(appels).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // `registre.lang` est ecrit par le I18nProvider de ce test, pas par l'apercu : aucun
    // brouillon (`meddata:draft:…`) ni aucune autre cle ne doit apparaitre.
    expect(Object.keys(localStorage).filter((k) => k !== 'registre.lang')).toEqual([]);
  });
});
