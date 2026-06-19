import { useI18n } from '../i18n/useI18n';

export function NotFound() {
  const { t } = useI18n();
  return (
    <section className="text-center text-slate-500">
      <h1 className="text-2xl font-semibold text-slate-700">404</h1>
      <p>{t('notfound.title')}</p>
    </section>
  );
}
