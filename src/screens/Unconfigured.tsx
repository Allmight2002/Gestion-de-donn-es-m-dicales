import { useI18n } from '../i18n/useI18n';

// Affiche quand les variables d'env Supabase sont absentes : evite un crash et
// guide la configuration. (Le frontend n'utilise jamais la cle service_role.)
export function Unconfigured() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h1 className="mb-2 text-lg font-semibold">{t('unconfigured.title')}</h1>
        <p className="text-sm">{t('unconfigured.body')}</p>
        <pre className="mt-4 overflow-x-auto rounded bg-amber-100 p-3 text-xs">
{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}
        </pre>
      </div>
    </div>
  );
}
