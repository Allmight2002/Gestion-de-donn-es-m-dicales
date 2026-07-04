import { errorMessage } from '../../lib/errorMessage';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useTemplateRepository } from '../../data/RepositoryProvider';
import { TEMPLATE_LIBRARY, type StarterTemplate } from '../../domain/templateLibrary';

// F3 — Bibliotheque de gabarits par specialite : dupliquer un modele credible puis l'adapter.
export function TemplateLibrary() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const templates = useTemplateRepository();

  const [busy, setBusy] = useState<string | null>(null); // id du modele en cours de creation
  const [error, setError] = useState<string | null>(null);

  async function use(model: StarterTemplate) {
    setBusy(model.id);
    try {
      const version = await templates.createPersonalTemplate(model.name, model.specialty);
      for (const field of model.fields) await templates.addField(version.id, field);
      navigate('/templates');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <button onClick={() => navigate('/templates')} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('mytemplates.title')}</button>
        <h1 className="page-title mt-2">{t('tlib.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('tlib.subtitle')}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATE_LIBRARY.map((m) => (
          <div key={m.id} className="card flex flex-col gap-2 p-4">
            <div>
              <p className="font-medium text-slate-800">{m.name}</p>
              <p className="text-xs text-teal-700">{m.specialty}</p>
            </div>
            <p className="flex-1 text-sm text-slate-500">{m.description}</p>
            <p className="text-xs text-slate-400">{m.fields.length} {t('tlib.fields')}</p>
            <button onClick={() => void use(m)} disabled={busy !== null} className="btn-primary self-start">
              {busy === m.id ? t('tlib.creating') : t('tlib.use')}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
