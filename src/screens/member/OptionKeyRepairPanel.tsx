import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { OptionKeyRepairPreview, OptionKeyRepairResult } from '../../data/bases';
import { errorMessage } from '../../lib/errorMessage';
import { SectionCard } from '../../components/SectionCard';

/**
 * L30 — conversion des valeurs orphelines d'une liste controlee.
 *
 * Un renommage anterieur au lot laissait des fiches portant une chaine absente de la
 * liste : invalides a la prochaine ecriture, et comptees comme une modalite distincte.
 * Cet ecran les recense puis, sur demande explicite, les ramene sur leur option.
 *
 * Deux gestes SEPARES, jamais fusionnes : l'analyse ne modifie rien, la conversion ne
 * part qu'au second clic. Une valeur qui ne correspond a aucune option -- ou a plusieurs
 * -- bloque sa fiche et est affichee telle quelle : elle n'est jamais devinee.
 */
export function OptionKeyRepairPanel({ baseId }: { baseId: string }) {
  const { t } = useI18n();
  const bases = useBaseRepository();
  const [preview, setPreview] = useState<OptionKeyRepairPreview | null>(null);
  const [result, setResult] = useState<OptionKeyRepairResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await bases.previewOptionKeyRepair(baseId));
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await bases.repairOptionKeys(baseId);
      setResult(outcome);
      // L'apercu est immediatement rejoue : ce qui reste affiche est l'etat REEL apres
      // conversion, pas la photo d'avant.
      setPreview(await bases.previewOptionKeyRepair(baseId));
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  const nothingToDo = preview !== null && preview.records.repairable === 0 && preview.records.blocked === 0;

  return (
    <SectionCard title={t('options.repair_title')} description={t('options.repair_intro')} icon={Wrench}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void analyse()}>
          {t('options.repair_preview')}
        </button>
        {preview && preview.records.repairable > 0 && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void convert()}>
            {t('options.repair_run')}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <p role="status" className="mt-3 text-sm text-slate-700">
          <strong>{t('options.repair_done')}</strong>{' '}
          {t('options.repair_result')
            .replace('{repaired}', String(result.repairedRecords))
            .replace('{blocked}', String(result.blockedRecords))
            .replace('{skipped}', String(result.skippedRecords))
            .replace('{failed}', String(result.failedRecords))}
        </p>
      )}

      {nothingToDo && <p className="mt-3 text-sm text-slate-600">{t('options.repair_none')}</p>}

      {preview && !nothingToDo && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-slate-700">
            {preview.records.repairable} {t('options.repair_repairable')} ·{' '}
            {preview.records.blocked} {t('options.repair_blocked')}
          </p>
          {preview.fields.map((field) => (
            <div key={`${field.entity}:${field.fieldKey}`} className="surface-muted p-3">
              <p className="font-medium text-slate-800">{field.label}</p>
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {field.mappings.map((m) => (
                  <li key={`${m.from}→${m.to}`}>
                    « {m.from} » {t('options.repair_mapping')} « {m.to} » ({m.occurrences})
                  </li>
                ))}
              </ul>
              {field.blockingValues.length > 0 && (
                <div className="mt-2">
                  <ul className="space-y-0.5 text-amber-800">
                    {field.blockingValues.map((b) => (
                      <li key={b.value}>⚠️ « {b.value} » ({b.occurrences})</li>
                    ))}
                  </ul>
                  <p className="helper-text mt-1">{t('options.repair_blocked_hint')}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
