// @vitest-environment jsdom
// UI-2 : primitives du langage visuel — pastilles de statut, dates lisibles, modale de
// confirmation, toasts.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n/I18nProvider';
import { StatusBadge } from './StatusBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { ToastProvider, useToast } from './Toast';
import { formatDate, formatDateTime } from '../lib/formatDate';
import { PageHeader } from './PageHeader';
import { EmptyState } from './EmptyState';
import { WorkflowSteps } from './WorkflowSteps';

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe('StatusBadge', () => {
  test('libelles traduits + couleurs distinctes par statut', () => {
    wrap(<><StatusBadge status="draft" /><StatusBadge status="complete" /><StatusBadge status="curated" /></>);
    expect(screen.getByText('Brouillon').className).toContain('amber');
    expect(screen.getByText('Complété').className).toContain('sky');
    expect(screen.getByText('Finalisé').className).toContain('green');
  });
});

describe('formatDate', () => {
  test('date et horodatage lisibles en francais ; valeur illisible renvoyee telle quelle', () => {
    expect(formatDate('2026-06-28', 'fr')).toMatch(/28.*juin.*2026/);
    expect(formatDateTime('2026-06-28T10:32:00', 'fr')).toMatch(/28.*juin.*2026.*10:32/);
    expect(formatDate('pas-une-date', 'fr')).toBe('pas-une-date');
  });
});

describe('ConfirmDialog', () => {
  test('confirme / annule (bouton + Echap)', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    wrap(<ConfirmDialog open title="Supprimer ?" body="Irreversible." onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { name: 'Supprimer ?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

function ToastTester() {
  const { toast } = useToast();
  return <button onClick={() => toast('Rencontre enregistrée')}>go</button>;
}

describe('Toast', () => {
  test('affiche la confirmation apres action', async () => {
    wrap(<ToastProvider><ToastTester /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Rencontre enregistrée')).toBeInTheDocument();
  });
});

describe('primitives de structure', () => {
  test('expose une hierarchie de page et un etat vide actionnable', () => {
    wrap(
      <>
        <PageHeader title="Cohortes" description="Populations d’étude" actions={<button>Créer</button>} />
        <WorkflowSteps steps={[{ label: 'Définir' }, { label: 'Vérifier' }, { label: 'Enregistrer' }]} current={2} />
        <EmptyState title="Aucune cohorte" action={<button>Commencer</button>} />
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Cohortes' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Progression' })).toBeInTheDocument();
    expect(screen.getByText('Vérifier').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeInTheDocument();
  });
});
