import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { ChoiceCard } from './ChoiceCard';

// Point d'entree unique "Nouveau patient" (cahier v3.0, retours UX) : le medecin choisit
// entre saisir lui-meme les donnees, ou confier les documents au staff (pool de curation).
export function PatientCreateChoice() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <h1 className="page-title mt-2">{t('patient.new')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('create.choose')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <ChoiceCard
          icon="✍️"
          title={t('create.self')}
          hint={t('create.self_hint')}
          onClick={() => navigate(`/bases/${baseId}/patients/new/manual`)}
        />
        <ChoiceCard
          icon="📨"
          title={t('create.submit')}
          hint={t('create.submit_hint')}
          onClick={() => navigate(`/bases/${baseId}/patients/new/submit`)}
        />
      </div>
    </section>
  );
}
