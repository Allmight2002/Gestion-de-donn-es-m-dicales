import { useRef, useState, type ChangeEvent } from 'react';
import { errorMessage } from '../../lib/errorMessage';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateBundleResult } from '../../data/templates';
import { useToast } from '../../components/Toast';
import {
  downloadTemplateDefinition,
  parseTemplateDefinition,
  templateDefinitionFileName,
} from '../../domain/templateDefinition';

/**
 * Export / import d'un jeu de variables par fichier, partage par « Mes jeux de variables »
 * (medecin) et l'administration des gabarits. L'import cree toujours un gabarit PERSONNEL
 * brouillon ; l'administrateur le promeut ensuite en modele global s'il le souhaite.
 */
export function useTemplateTransfer(onImported: (result: TemplateBundleResult, name: string) => void) {
  const repo = useTemplateRepository();
  const { t } = useI18n();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const available = Boolean(repo.exportTemplateDefinition && repo.importTemplateDefinition);

  async function exportVersion(versionId: string, name: string, versionNumber?: number) {
    if (!repo.exportTemplateDefinition || busy) return;
    setBusy(true);
    try {
      const definition = await repo.exportTemplateDefinition(versionId);
      downloadTemplateDefinition(definition, templateDefinitionFileName(name, versionNumber));
      toast(t('transfer.exported'));
    } catch (e) {
      toast(errorMessage(e, t('common.error')), 'warning');
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reinitialiser permet de reimporter le MEME fichier apres une correction.
    event.target.value = '';
    if (!file || !repo.importTemplateDefinition) return;
    setBusy(true);
    try {
      const parsed = parseTemplateDefinition(await file.text());
      if (!parsed.ok) {
        toast(t(`transfer.${parsed.error}` as const), 'warning');
        return;
      }
      const name = parsed.definition.template.name?.trim() || file.name.replace(/\.meddata\.json$|\.json$/i, '');
      // Une cle par fichier choisi : un double envoi du meme choix ne cree qu'un gabarit.
      const result = await repo.importTemplateDefinition({
        definition: parsed.definition, name, operationKey: crypto.randomUUID(),
      });
      toast(t('transfer.imported').replace('{name}', name));
      onImported(result, name);
    } catch (e) {
      toast(errorMessage(e, t('common.error')), 'warning');
    } finally {
      setBusy(false);
    }
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      aria-label={t('transfer.import')}
      data-testid="template-definition-input"
      onChange={(event) => void importFile(event)}
    />
  );

  return { available, busy, input, exportVersion, pickFile: () => inputRef.current?.click() };
}
