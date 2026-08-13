// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { EncounterFields } from './EncounterFields';

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
