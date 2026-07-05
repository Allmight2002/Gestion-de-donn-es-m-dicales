import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { NewField, TemplateField } from '../../data/types';
import type { PublishedTemplateOption } from '../../data/bases';
import { TEMPLATE_LIBRARY } from '../../domain/templateLibrary';

// F3 v2 — Bibliotheque de gabarits par specialite, alimentee par les GABARITS GLOBAUX (cures par
// l'admin systeme dans /admin, stockes en base). « Utiliser » clone les champs du modele dans un
// gabarit PERSONNEL. Repli sur les modeles livres en dur tant qu'aucun modele global n'est publie
// (la bibliotheque n'est jamais vide).
const toNewField = (f: TemplateField): NewField => ({
  fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type,
  required: f.required, allowedValues: f.allowedValues ? f.allowedValues.map(String) : null,
  minValue: f.minValue, maxValue: f.maxValue, unit: f.unit,
  allowMissingCodes: f.allowMissingCodes, encounterTypes: f.encounterTypes,
});

export function TemplateLibrary() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();

  const [globals, setGlobals] = useState<PublishedTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // cle du modele en cours de creation
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bases.listTemplateModels()
      .then((m) => setGlobals(m.filter((x) => x.scope === 'global')))
      .catch(() => setGlobals([]))
      .finally(() => setLoading(false));
  }, [bases]);

  // Cree un gabarit personnel a partir d'un nom/specialite + d'une resolution paresseuse des champs.
  const createFrom = useCallback(async (key: string, name: string, specialty: string | null, resolveFields: () => Promise<NewField[]>) => {
    setBusy(key);
    try {
      const fields = await resolveFields();
      const version = await templates.createPersonalTemplate(name, specialty);
      for (const f of fields) await templates.addField(version.id, f);
      navigate('/templates');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;

  const useBuiltin = globals.length === 0;

  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <button onClick={() => navigate('/templates')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('mytemplates.title')}</button>
        <h1 className="page-title mt-2">{t('tlib.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('tlib.subtitle')}</p>
        {useBuiltin && <p className="mt-1 text-xs text-amber-700">{t('tlib.builtin_note')}</p>}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {useBuiltin
          ? TEMPLATE_LIBRARY.map((m) => (
              <div key={m.id} className="card flex flex-col gap-2 p-4">
                <div>
                  <p className="font-medium text-slate-800">{m.name}</p>
                  <p className="text-xs text-teal-700">{m.specialty}</p>
                </div>
                <p className="flex-1 text-sm text-slate-500">{m.description}</p>
                <p className="text-xs text-slate-400">{m.fields.length} {t('tlib.fields')}</p>
                <button onClick={() => void createFrom(m.id, m.name, m.specialty, async () => m.fields)} disabled={busy !== null} className="btn-primary self-start">
                  {busy === m.id ? t('tlib.creating') : t('tlib.use')}
                </button>
              </div>
            ))
          : globals.map((m) => (
              <div key={m.versionId} className="card flex flex-col gap-2 p-4">
                <div>
                  <p className="font-medium text-slate-800">{m.name}</p>
                  <p className="text-xs text-teal-700">{m.specialty ?? '—'}</p>
                </div>
                <p className="flex-1 text-sm text-slate-400">{t('tlib.global_hint')}</p>
                <button
                  onClick={() => void createFrom(m.versionId, m.name, m.specialty, async () => (await templates.getVersion(m.versionId)).fields.map(toNewField))}
                  disabled={busy !== null}
                  className="btn-primary self-start"
                >
                  {busy === m.versionId ? t('tlib.creating') : t('tlib.use')}
                </button>
              </div>
            ))}
      </div>
    </section>
  );
}
