import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { NewField } from '../../data/types';
import type { PublishedTemplateOption } from '../../data/bases';
import { TEMPLATE_LIBRARY } from '../../domain/templateLibrary';
import { SkeletonList } from '../../components/Skeleton';

// F3 v2 — Bibliotheque de gabarits par specialite, alimentee par les GABARITS GLOBAUX (cures par
// l'admin systeme dans /admin, stockes en base). « Utiliser » clone les champs du modele dans un
// gabarit PERSONNEL. Repli sur les modeles livres en dur tant qu'aucun modele global n'est publie
// (la bibliotheque n'est jamais vide).
export function TemplateLibrary() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();

  const [globals, setGlobals] = useState<PublishedTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // cle du modele en cours de creation
  const [error, setError] = useState<string | null>(null);
  const operationKeys = useRef(new Map<string, string>());

  useEffect(() => {
    bases.listTemplateModels()
      .then((m) => setGlobals(m.filter((x) => x.scope === 'global')))
      .catch(() => setGlobals([]))
      .finally(() => setLoading(false));
  }, [bases]);

  // Cree un gabarit personnel a partir d'un nom/specialite + d'une resolution paresseuse des champs.
  const createFrom = useCallback(async (key: string, name: string, specialty: string | null, input: { fields?: NewField[]; sourceVersionId?: string }) => {
    setBusy(key);
    try {
      const operationKey = operationKeys.current.get(key) ?? crypto.randomUUID();
      operationKeys.current.set(key, operationKey);
      await templates.createTemplateBundle({ name, specialty, ...input, operationKey });
      navigate('/templates');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;

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
                <button onClick={() => void createFrom(m.id, m.name, m.specialty, { fields: m.fields })} disabled={busy !== null} className="btn-primary self-start">
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
                  onClick={() => void createFrom(m.versionId, m.name, m.specialty, { sourceVersionId: m.versionId })}
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
