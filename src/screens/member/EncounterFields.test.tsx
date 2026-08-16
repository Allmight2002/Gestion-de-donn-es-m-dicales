// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TemplateField } from '../../data/types';
import { EncounterFields, HiddenValuesNotice } from './EncounterFields';

describe('EncounterFields description', () => {
  test('opens the accessible guidance without extending the form initially', async () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[{
            id: 'glasgow', fieldKey: 'glasgow', label: 'Score de Glasgow',
            description: 'Premier score documenté avant toute sédation', scope: 'encounter', section: 'clinique',
            type: 'integer', unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
            allowMissingCodes: false, displayOrder: 0,
          }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    const help = screen.getByRole('button', { name: 'Afficher la consigne de saisie' });
    await userEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Premier score documenté avant toute sédation');
  });
});

const imagerie = [
  {
    id: 'imagerie_faite', fieldKey: 'imagerie_faite', label: 'Imagerie faite', scope: 'encounter' as const,
    section: 'paraclinique' as const, type: 'boolean' as const, unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  },
  {
    id: 'imagerie_type', fieldKey: 'imagerie_type', label: 'Type d’imagerie', scope: 'encounter' as const,
    section: 'paraclinique' as const, type: 'text' as const, unit: null, allowedValues: null,
    required: true, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 1,
  },
];

describe('EncounterFields — affichage conditionnel (L32)', () => {
  test('une variable masquee n\'est pas rendue du tout', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={imagerie}
          values={{}}
          hiddenKeys={new Set(['imagerie_type'])}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Imagerie faite')).toBeInTheDocument();
    expect(screen.queryByText('Type d’imagerie')).toBeNull();
  });

  test('sans masquage, la meme variable est bien la', () => {
    render(
      <I18nProvider>
        <EncounterFields fields={imagerie} values={{}} onChange={() => undefined} onRemove={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.getByText('Type d’imagerie')).toBeInTheDocument();
  });
});

describe('HiddenValuesNotice — l\'effacement s\'annonce (L32)', () => {
  test('nomme le nombre de valeurs et les variables concernees', () => {
    render(
      <I18nProvider>
        <HiddenValuesNotice removedKeys={['imagerie_type']} fields={imagerie} />
      </I18nProvider>,
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('1 valeur(s)');
    expect(notice).toHaveTextContent('Type d’imagerie');
  });

  test('rien a retirer -> aucun bandeau : on n\'inquiete pas sans raison', () => {
    render(
      <I18nProvider>
        <HiddenValuesNotice removedKeys={[]} fields={imagerie} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// L31 — sections personnalisables
// ---------------------------------------------------------------------------

const champ = (over: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label' | 'section'>): TemplateField => ({
  scope: 'encounter', type: 'text', unit: null, allowedValues: null, required: false,
  minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...over,
});

describe('EncounterFields — sections personnalisables (L31)', () => {
  test('une section personnalisee est rendue avec SON libelle, pas son code', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'tdm', label: 'TDM', section: 'imagerie_cerebrale' })]}
          sections={[{ id: 's1', sectionKey: 'imagerie_cerebrale', label: 'Imagerie cérébrale', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Imagerie cérébrale' })).toBeInTheDocument();
  });

  test('les trois sections historiques gardent leur libelle TRADUIT, pas celui stocke', () => {
    // Une base existante ne doit pas changer d'apparence : le libelle stocke par la
    // migration ne doit pas se substituer a la traduction.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'sexe', label: 'Sexe', section: 'clinique' })]}
          sections={[{ id: 's1', sectionKey: 'clinique', label: 'PEU IMPORTE', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Clinique' })).toBeInTheDocument();
  });

  test('LE FILET : une variable sans section reste affichee sous « Autre »', () => {
    // C'est le point 4 du lot. Une variable invisible n'est jamais saisie, et personne
    // ne s'en apercoit : ce repli doit survivre a toute evolution du regroupement.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'orpheline', label: 'Variable orpheline', section: '' })]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'Autre' })).toBeInTheDocument();
    expect(screen.getByText('Variable orpheline')).toBeInTheDocument();
  });

  test('une section inconnue de la liste reste affichee, sous son code', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[champ({ id: 'a', fieldKey: 'x', label: 'Variable X', section: 'section_retiree' })]}
          sections={[{ id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 }]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('group', { name: 'section_retiree' })).toBeInTheDocument();
    expect(screen.getByText('Variable X')).toBeInTheDocument();
  });

  test('sans liste de sections, l ordre historique est conserve', () => {
    // Sans ce repli, une base qui n'a rien change verrait son formulaire se reorganiser
    // tout seul au deploiement : ici la paraclinique est declaree en premier.
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'imagerie', label: 'Imagerie', section: 'paraclinique', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 1 }),
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Symptome');
    expect(groups[1]).toContain('Imagerie');
  });

  test('l ordre voulu par le proprietaire prime sur l ordre historique', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'imagerie', label: 'Imagerie', section: 'paraclinique', displayOrder: 1 }),
          ]}
          sections={[
            { id: 's1', sectionKey: 'paraclinique', label: 'Paraclinique', displayOrder: 0 },
            { id: 's2', sectionKey: 'clinique', label: 'Clinique', displayOrder: 1 },
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Imagerie');
    expect(groups[1]).toContain('Symptome');
  });

  test('le filet ferme la marche, meme reordonne', () => {
    render(
      <I18nProvider>
        <EncounterFields
          fields={[
            champ({ id: 'a', fieldKey: 'orpheline', label: 'Orpheline', section: '', displayOrder: 0 }),
            champ({ id: 'b', fieldKey: 'symptome', label: 'Symptome', section: 'clinique', displayOrder: 1 }),
          ]}
          values={{}}
          onChange={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );
    const groups = screen.getAllByRole('group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain('Symptome');
    expect(groups[1]).toContain('Orpheline');
  });
});
