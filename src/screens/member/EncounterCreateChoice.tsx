import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useCurationRepository } from '../../data/RepositoryProvider';
import { ChoiceCard } from './ChoiceCard';

// Point d'entree "Ajouter une rencontre" (cahier v3.0) : le medecin choisit entre saisir
// lui-meme la rencontre, ou confier les documents au staff (pool, portee 'encounter').
export function EncounterCreateChoice() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const curation = useCurationRepository();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitToStaff() {
    if (!baseId || !patientId) return;
    setBusy(true);
    try {
      const { taskId } = await curation.createSubmission(baseId, patientId, null, 'encounter');
      navigate(`/curation/${taskId}`); // -> depot des documents deidentifies
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('encounter.new')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('create.choose')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-4 sm:flex-row">
        <ChoiceCard
          icon="✍️"
          title={t('create.self')}
          hint={t('create.self_hint_enc')}
          onClick={() => navigate(`/bases/${baseId}/patients/${patientId}/encounters/new/manual`)}
        />
        <ChoiceCard
          icon="📨"
          title={t('create.submit')}
          hint={t('create.submit_hint_enc')}
          onClick={() => void submitToStaff()}
          disabled={busy}
        />
      </div>
    </section>
  );
}
