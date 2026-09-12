// @vitest-environment jsdom
// UX-14(d) — déplacement direct d'une variable.
//
// Ce que ces tests protègent : l'ordre remis au serveur est bien celui annoncé à l'écran, la
// destination est lisible AVANT de confirmer, et le déplacement se fait entièrement avec des
// commandes natives — donc au clavier, sans geste de précision sur 216 lignes.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { TemplateField, TemplateSection } from '../../data/types';
import { I18nProvider } from '../../i18n/I18nProvider';
import { FieldMoveDialog, computeMovedOrder } from './FieldMoveDialog';

const field = (id: string, fieldKey: string, label: string, section: string | null): TemplateField => ({
  id, fieldKey, label, scope: 'encounter', section, type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const sections: TemplateSection[] = [
  { id: 's1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 },
  { id: 's2', sectionKey: 'biologie', label: 'Biologie', displayOrder: 1 },
];

const fields = [
  field('f1', 'tension', 'Tension artérielle', 'clinique'),
  field('f2', 'pouls', 'Pouls', 'clinique'),
  field('f3', 'temperature', 'Température', 'clinique'),
  field('f4', 'hemoglobine', 'Hémoglobine', 'biologie'),
  field('f5', 'motif', 'Motif', null),
];

describe('computeMovedOrder — UX-14(d)', () => {
  test('place la variable juste après ou juste avant son repère', () => {
    expect(computeMovedOrder(fields, fields[0], 'clinique', 'after', 'temperature'))
      .toEqual(['f2', 'f3', 'f1', 'f4', 'f5']);
    expect(computeMovedOrder(fields, fields[2], 'clinique', 'before', 'tension'))
      .toEqual(['f3', 'f1', 'f2', 'f4', 'f5']);
  });

  test('en tête ou en fin, le rang se calcule dans la SECTION d\'arrivée, pas dans la liste', () => {
    // « En fin de Clinique » n'est pas « en fin de modèle » : biologie et le tronc commun suivent.
    expect(computeMovedOrder(fields, fields[0], 'clinique', 'end', ''))
      .toEqual(['f2', 'f3', 'f1', 'f4', 'f5']);
    expect(computeMovedOrder(fields, fields[3], 'clinique', 'start', ''))
      .toEqual(['f4', 'f1', 'f2', 'f3', 'f5']);
  });

  test('changer de section déplace aussi le rang, et une section vide reçoit la variable', () => {
    expect(computeMovedOrder(fields, fields[0], 'biologie', 'after', 'hemoglobine'))
      .toEqual(['f2', 'f3', 'f4', 'f1', 'f5']);
    // Aucune variable dans la section d'arrivée : rien à quoi s'accrocher, la fin fait foi.
    const vide = [fields[0], fields[1]];
    expect(computeMovedOrder(vide, fields[0], 'biologie', 'start', ''))
      .toEqual(['f2', 'f1']);
  });

  test('un repère devenu introuvable ne réordonne rien plutôt que de deviner', () => {
    expect(computeMovedOrder(fields, fields[0], 'clinique', 'after', 'variable_effacee'))
      .toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });
});

describe('FieldMoveDialog — UX-14(d)', () => {
  function open(moved = fields[0]) {
    const onMove = vi.fn();
    render(<I18nProvider>
      <FieldMoveDialog field={moved} fields={fields} sections={sections} onCancel={() => {}} onMove={onMove} />
    </I18nProvider>);
    return onMove;
  }

  test('annonce la destination avant de confirmer, et n\'accepte pas un repère manquant', async () => {
    const user = userEvent.setup();
    const onMove = open();

    // « Après une variable » est proposé d'emblée, mais sans repère il n'y a rien à confirmer.
    expect(screen.getByText(/Choisissez la variable de repère/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déplacer la variable' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Variable de repère'), 'temperature');
    expect(screen.getByText(/« Tension artérielle » sera placée après « Température », dans Clinique\./))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Déplacer la variable' }));
    expect(onMove).toHaveBeenCalledWith({ section: 'clinique', orderedIds: ['f2', 'f3', 'f1', 'f4', 'f5'] });
  });

  test('la section d\'arrivée change les repères proposés et remet le choix à zéro', async () => {
    const user = userEvent.setup();
    const onMove = open();

    await user.selectOptions(screen.getByLabelText('Variable de repère'), 'pouls');
    await user.selectOptions(screen.getByLabelText('Section d’arrivée'), 'biologie');

    // Le repère précédent appartenait à l'ancienne section : le garder désignerait une place
    // qui n'existe pas dans la destination.
    const reperes = screen.getByLabelText('Variable de repère') as HTMLSelectElement;
    expect(reperes.value).toBe('');
    expect([...reperes.options].map((option) => option.textContent))
      .toEqual([expect.stringContaining('Choisir'), expect.stringContaining('Hémoglobine')]);

    await user.selectOptions(reperes, 'hemoglobine');
    await user.click(screen.getByRole('button', { name: 'Déplacer la variable' }));
    expect(onMove).toHaveBeenCalledWith({ section: 'biologie', orderedIds: ['f2', 'f3', 'f4', 'f1', 'f5'] });
  });

  test('« en tête » se confirme sans repère, et le tronc commun est une destination', async () => {
    const user = userEvent.setup();
    const onMove = open(fields[3]);

    await user.selectOptions(screen.getByLabelText('Section d’arrivée'), '');
    await user.click(screen.getByRole('radio', { name: 'En tête de la section' }));

    expect(screen.getByText(/« Hémoglobine » sera placée en tête de Tronc commun\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('Variable de repère')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Déplacer la variable' }));
    expect(onMove).toHaveBeenCalledWith({ section: null, orderedIds: ['f1', 'f2', 'f3', 'f4', 'f5'] });
  });

  test('tout le déplacement se fait au clavier', async () => {
    const user = userEvent.setup();
    const onMove = open();

    // Le repère est choisi d'abord : tant qu'il manque, la confirmation est désactivée, donc
    // hors du parcours de tabulation — c'est voulu, et ce n'est pas ce qu'on mesure ici.
    await user.selectOptions(screen.getByLabelText('Variable de repère'), 'temperature');

    // Chaque commande du déplacement est atteinte par la seule tabulation : aucune ne demande
    // un pointeur, ni un glissement, ni un maintien.
    const atteints = new Set<Element>();
    for (let pas = 0; pas < 10; pas += 1) {
      await user.tab();
      if (document.activeElement) atteints.add(document.activeElement);
    }
    expect(atteints).toContain(screen.getByLabelText('Section d’arrivée'));
    // Un groupe de boutons radio est UN seul arrêt de tabulation : c'est l'option cochée
    // qui le représente, les autres se rejoignant aux flèches. C'est le comportement natif,
    // et c'est celui qu'il faut préserver.
    expect(atteints).toContain(screen.getByRole('radio', { name: 'Après une variable' }));
    expect(atteints).toContain(screen.getByLabelText('Variable de repère'));
    expect(atteints).toContain(screen.getByRole('button', { name: 'Déplacer la variable' }));

    // Et le déplacement se conclut au clavier, du choix de la section à la confirmation.
    (screen.getByLabelText('Section d’arrivée') as HTMLSelectElement).focus();
    await user.selectOptions(document.activeElement as HTMLSelectElement, 'biologie');
    await user.selectOptions(screen.getByLabelText('Variable de repère'), 'hemoglobine');
    screen.getByRole('button', { name: 'Déplacer la variable' }).focus();
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith({ section: 'biologie', orderedIds: ['f2', 'f3', 'f4', 'f1', 'f5'] });
  });
});
