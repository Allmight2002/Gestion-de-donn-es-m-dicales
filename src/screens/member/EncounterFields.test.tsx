// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
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
