import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/useI18n';
import { useBaseRepository } from '../../data/RepositoryProvider';
import type { BaseListing } from '../../data/bases';
import { TemplateVersionEditor } from '../staff/TemplateVersionEditor';

// Edition LIBRE du gabarit d'une base par son medecin proprietaire (cahier v3.0) :
// ajouter / modifier / supprimer des variables. Reutilise l'editeur de version (sans les
// actions admin publier/dupliquer). Le gabarit est une copie personnelle propre a la base.
export function BaseTemplateEditor() {
  const { id: baseId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();

  const [listing, setListing] = useState<BaseListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      setListing(await bases.getBase(baseId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, bases]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-slate-500">{t('common.loading')}</p>;
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!listing) return <p className="text-slate-500">{t('notfound.title')}</p>;

  const back = () => navigate(`/bases/${baseId}`);

  if (listing.role !== 'owner') return <p className="text-slate-500">{t('access.owner_only')}</p>;
  if (!listing.base.currentTemplateVersionId) return <p className="text-slate-500">{t('common.error')}</p>;

  return (
    <section className="space-y-4">
      <div>
        <button onClick={back} className="text-sm font-medium text-slate-500 hover:text-teal-700">← {t('admin.back')}</button>
        <h1 className="page-title mt-2">{t('basetemplate.title')}</h1>
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{t('basetemplate.hint')}</p>
      <TemplateVersionEditor
        versionId={listing.base.currentTemplateVersionId}
        onBack={back}
        showVersionActions={false}
        onNewVersion={async (id) => { await bases.setTemplateVersion(baseId!, id); await load(); }}
      />
    </section>
  );
}
