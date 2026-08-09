import { errorMessage } from '../../lib/errorMessage';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useI18n } from '../../i18n/useI18n';
import { useAccessRepository } from '../../data/RepositoryProvider';

// Acceptation d'une invitation via un lien a usage unique (cahier §8.10, critere 10).
export function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { t } = useI18n();
  const accessRepo = useAccessRepository();
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    if (!token) {
      setStatus('error');
      setError('token');
      return;
    }
    accessRepo
      .acceptInvitation(token)
      .then(() => on && setStatus('ok'))
      .catch((e) => {
        if (!on) return;
        setStatus('error');
        setError(errorMessage(e, t('common.error')));
      });
    return () => {
      on = false;
    };
  }, [token, accessRepo, t]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="card w-full max-w-md p-7 text-center">
        <h1 className="mb-3 text-lg font-semibold tracking-tight text-slate-900">{t('access.accept_title')}</h1>
        {status === 'pending' && <p className="text-slate-500">{t('access.accepting')}</p>}
        {status === 'ok' && <p className="text-teal-700">{t('access.accept_ok')}</p>}
        {status === 'error' && <p role="alert" className="text-red-600">{error}</p>}
        <button onClick={() => navigate('/')} className="btn-primary mt-4 w-full sm:w-auto">
          {t('access.go_dashboard')}
        </button>
      </div>
    </div>
  );
}
