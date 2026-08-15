// @vitest-environment jsdom
// F4 : le formulaire de variable doit permettre de GARNIR une liste controlee sans la taper
// entierement a la main — sinon l'utilisateur retombe sur du texte libre, donc sur des donnees
// non analysables.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { FieldForm } from './FieldForm';

function renderForm(onSubmit = vi.fn()) {
  render(
    <I18nProvider>
      <FieldForm onSubmit={onSubmit} />
    </I18nProvider>,
  );
  return onSubmit;
}

async function chooseSelectType() {
  await userEvent.selectOptions(screen.getByLabelText('Type'), 'select');
}

describe('FieldForm — jeux de valeurs (F4)', () => {
  test('les listes pretes a l emploi n apparaissent que pour un champ a choix', async () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Insérer' })).toBeNull();
    await chooseSelectType();
    expect(screen.getByRole('button', { name: 'Insérer' })).toBeInTheDocument();
  });

  test('inserer une liste cree les options et les compte', async () => {
    renderForm();
    await chooseSelectType();
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));

    expect(screen.getByLabelText('Libellé de l’option 1')).toHaveValue('Oui');
    expect(screen.getByLabelText('Libellé de l’option 3')).toHaveValue('Inconnu');
    expect(screen.getByText('3 valeur(s) définie(s)')).toBeInTheDocument();
  });

  test('l insertion complete la saisie existante au lieu de l ecraser', async () => {
    renderForm();
    await chooseSelectType();
    await userEvent.type(screen.getByLabelText('Ajouter l’option'), 'Oui');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter l’option' }));
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));

    // Oui n'est pas dedouble ; Non et Inconnu s'ajoutent a la suite.
    expect(screen.getByText('3 valeur(s) définie(s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Libellé de l’option 1')).toHaveValue('Oui');
  });

  test('les valeurs inserees sont transmises au gabarit une par une', async () => {
    const onSubmit = renderForm();
    await chooseSelectType();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'issue');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Issue');
    await userEvent.selectOptions(screen.getByLabelText("Liste prête à l'emploi"), 'oui-non-inconnu');
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    // L30 : ce qui part en base est le CODE ; le libelle voyage a cote et reste modifiable.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldKey: 'issue', type: 'select', allowedValues: ['oui', 'non', 'inconnu'],
        allowedOptions: [
          { valueKey: 'oui', label: 'Oui', isActive: true },
          { valueKey: 'non', label: 'Non', isActive: true },
          { valueKey: 'inconnu', label: 'Inconnu', isActive: true },
        ],
      }),
      undefined,
    );
  });
});

// L30 : le libelle se corrige, le code ne bouge pas. C'est ce qui permet de rattraper
// une option mal orthographiee sans invalider les fiches deja saisies.
describe('FieldForm — options a code stable (L30)', () => {
  const listeEnService = {
    fieldKey: 'evolution', label: 'Évolution', scope: 'encounter' as const, section: 'clinique' as const,
    type: 'select' as const, required: false,
    allowedValues: ['gueri', 'deces'],
    allowedOptions: [
      { valueKey: 'gueri', label: 'Gueri', isActive: true },
      { valueKey: 'deces', label: 'Décès', isActive: true },
    ],
  };

  function renderExisting(onSubmit = vi.fn(), locked = true) {
    render(
      <I18nProvider>
        <FieldForm onSubmit={onSubmit} lockStructural={locked} initial={listeEnService} submitLabel="Enregistrer" />
      </I18nProvider>,
    );
    return onSubmit;
  }

  test('renommer un libelle laisse le code intact', async () => {
    const onSubmit = renderExisting();
    const premier = screen.getByLabelText('Libellé de l’option 1');
    await userEvent.clear(premier);
    await userEvent.type(premier, 'Guéri');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedValues: ['gueri', 'deces'],
        allowedOptions: [
          { valueKey: 'gueri', label: 'Guéri', isActive: true },
          { valueKey: 'deces', label: 'Décès', isActive: true },
        ],
      }),
      undefined,
    );
  });

  test('sur une variable deja utilisee, supprimer une option n est pas offert — desactiver l est', async () => {
    renderExisting();
    expect(screen.queryByRole('button', { name: /^Supprimer/ })).toBeNull();
    expect(screen.getAllByLabelText('Désactiver').length).toBe(2);
    expect(screen.getByText(/ne peut plus être supprimée/)).toBeInTheDocument();
  });

  test('desactiver une option la transmet sans la retirer de la liste', async () => {
    const onSubmit = renderExisting();
    await userEvent.click(screen.getAllByLabelText('Désactiver')[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedValues: ['gueri', 'deces'],
        allowedOptions: [
          { valueKey: 'gueri', label: 'Gueri', isActive: true },
          { valueKey: 'deces', label: 'Décès', isActive: false },
        ],
      }),
      undefined,
    );
  });

  test('reordonner change l ordre des options, pas leurs codes', async () => {
    const onSubmit = renderExisting();
    await userEvent.click(screen.getByRole('button', { name: 'Descendre Gueri' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ allowedValues: ['deces', 'gueri'] }),
      undefined,
    );
  });

  test('une option en double est refusee a l ajout', async () => {
    renderExisting();
    await userEvent.type(screen.getByLabelText('Ajouter l’option'), 'gueri');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter l’option' }));
    expect(screen.getByRole('alert')).toHaveTextContent('existe déjà');
    expect(screen.getByText('2 valeur(s) définie(s)')).toBeInTheDocument();
  });

  test('la valeur proposee ne peut viser qu une option ACTIVE, et vaut le code', async () => {
    renderExisting(vi.fn(), false);
    await userEvent.click(screen.getAllByLabelText('Désactiver')[1]);
    const proposee = screen.getByLabelText('Valeur proposée');
    expect(within(proposee).queryByRole('option', { name: 'Décès' })).toBeNull();
    expect(within(proposee).getByRole('option', { name: 'Gueri' })).toHaveValue('gueri');
  });
});

describe('FieldForm description', () => {
  test('submits the data-entry guidance', async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'glasgow');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Score de Glasgow');
    await userEvent.type(screen.getByLabelText('Consigne de saisie'), 'Premier score documenté avant toute sédation');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Premier score documenté avant toute sédation',
    }), undefined);
  });
});

// F5 — la soupape cree un SECOND champ, transmis a part pour que l'appelant l'ajoute apres.
describe('FieldForm — soupape (F5)', () => {
  async function fillChoiceField() {
    await chooseSelectType();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'diagnostic');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Diagnostic');
  }

  test('la soupape n est proposee que pour un champ a choix', async () => {
    renderForm();
    expect(screen.queryByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' })).toBeNull();
    await chooseSelectType();
    expect(screen.getByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' })).toBeInTheDocument();
  });

  // La saisie couplee n'est rendue que pour les champs de rencontre : ne pas proposer la
  // soupape ailleurs, plutot que de promettre un comportement absent.
  test('la soupape n est pas proposee pour un champ patient', async () => {
    renderForm();
    await chooseSelectType();
    await userEvent.selectOptions(screen.getByLabelText('Portée'), 'patient');
    expect(screen.queryByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' })).toBeNull();
  });

  test('sans la case cochee, aucun champ compagnon n est demande', async () => {
    const onSubmit = renderForm();
    await fillChoiceField();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: 'diagnostic' }), undefined);
  });

  test('la case cochee demande un champ texte compagnon jamais obligatoire', async () => {
    const onSubmit = renderForm();
    await fillChoiceField();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Obligatoire' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'diagnostic', required: true }),
      expect.objectContaining({ fieldKey: 'diagnostic_autre', type: 'text', required: false }),
    );
  });
});

describe('FieldForm — base transversale (L9)', () => {
  test('masque la portée et enregistre toujours une variable participant', async () => {
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <FieldForm onSubmit={onSubmit} observationModel="cross_sectional" />
      </I18nProvider>,
    );
    expect(screen.queryByRole('combobox', { name: 'Portée' })).toBeNull();
    expect(screen.getByText('Données du formulaire unique')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'poids');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Poids');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'patient', encounterTypes: null }), undefined);
  });
});

describe('FieldForm — valeur proposée (L28)', () => {
  // Proposer une reponse a un jugement clinique fabrique de la donnee : le constructeur
  // avertit, mais n'interdit pas — le medecin connait sa variable.
  test('avertit quand la proposition porte sur un jugement clinique', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'complication');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Complication');
    expect(screen.queryByRole('status')).toBeNull();

    await userEvent.type(screen.getByLabelText('Valeur proposée'), 'aucune');
    expect(screen.getByRole('status')).toHaveTextContent('fabrique de la donnée');
  });

  test('avertit sur une variable oui/non, dont la proposition devient la réponse', async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'boolean');
    await userEvent.type(screen.getByLabelText('Clé technique'), 'fievre');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Fièvre');
    await userEvent.selectOptions(screen.getByLabelText('Valeur proposée'), 'true');
    expect(screen.getByRole('status')).toHaveTextContent('devient la réponse');
  });

  test('une variable neutre n avertit pas et transmet sa proposition', async () => {
    const onSubmit = renderForm();
    await userEvent.type(screen.getByLabelText('Clé technique'), 'pays');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Pays de résidence');
    await userEvent.type(screen.getByLabelText('Valeur proposée'), 'Tchad');
    expect(screen.queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'Tchad' }), undefined);
  });

  // Une date FIXEE dans le jeu de variables vieillit : le constructeur ne propose que le jour même.
  test('une date ne propose que la date du jour, transmise comme jeton', async () => {
    const onSubmit = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'date');
    await userEvent.type(screen.getByLabelText('Clé technique'), 'date_consultation');
    await userEvent.type(screen.getByLabelText('Libellé'), 'Date de consultation');
    await userEvent.selectOptions(screen.getByLabelText('Valeur proposée'), '__today__');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: '__today__' }), undefined);
  });

  test('aucune proposition n est offerte sur une liste multiple ni sur un diagnostic', async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'multiselect');
    expect(screen.queryByLabelText('Valeur proposée')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'terminology');
    expect(screen.queryByLabelText('Valeur proposée')).toBeNull();
  });
});

// L33 : les raisons de valeur manquante se choisissent variable par variable.
describe('FieldForm — raisons de valeur manquante (L33)', () => {
  async function nameField(key: string, label: string) {
    await userEvent.type(screen.getByLabelText('Clé technique'), key);
    await userEvent.type(screen.getByLabelText('Libellé'), label);
  }

  test('une variable neuve n accepte aucune valeur manquante tant que rien n est demande', async () => {
    const onSubmit = renderForm();
    expect(screen.queryByText('Raisons proposées à la saisie')).toBeNull();
    await nameField('sexe', 'Sexe');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ missingReasons: [], allowMissingCodes: false }),
      undefined,
    );
  });

  test('accepter les valeurs manquantes pre-coche les trois raisons historiques', async () => {
    const onSubmit = renderForm();
    await nameField('examen', 'Examen');
    await userEvent.click(screen.getByLabelText('Accepter une valeur manquante'));
    expect(screen.getByText('Raisons proposées à la saisie')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ missingReasons: ['non_fait', 'inconnu', 'non_applicable'] }),
      undefined,
    );
  });

  test('une variable peut proposer « refus » sans que « non fait » lui soit impose', async () => {
    const onSubmit = renderForm();
    await nameField('serologie', 'Sérologie VIH');
    await userEvent.click(screen.getByLabelText('Accepter une valeur manquante'));
    await userEvent.click(screen.getByLabelText('Non fait'));
    await userEvent.click(screen.getByLabelText('Inconnu'));
    await userEvent.click(screen.getByLabelText('Non applicable'));
    await userEvent.click(screen.getByLabelText('Refus du patient'));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ missingReasons: ['refus'], allowMissingCodes: true }),
      undefined,
    );
  });

  test('variable deja utilisee : les raisons en service sont grisees, en ajouter reste possible', async () => {
    render(
      <I18nProvider>
        <FieldForm
          onSubmit={vi.fn()}
          lockStructural
          initial={{
            fieldKey: 'examen', label: 'Examen', scope: 'encounter', section: 'clinique',
            type: 'text', required: false, allowMissingCodes: true, missingReasons: ['non_fait'],
          }}
        />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Non fait')).toBeDisabled();
    expect(screen.getByLabelText('Refus du patient')).toBeEnabled();
    // Couper la case maitresse reviendrait a tout retirer : le serveur le refuse.
    expect(screen.getByLabelText('Accepter une valeur manquante')).toBeDisabled();
  });
});
