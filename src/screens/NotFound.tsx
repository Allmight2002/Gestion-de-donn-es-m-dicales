import { useI18n } from '../i18n/useI18n';

export function NotFound() {
  const { t } = useI18n();
  return (
    <section className="mx-auto flex min-h-[55vh] max-w-lg items-center justify-center text-center">
      <div className="card w-full p-8 text-slate-500">
        <p className="eyebrow">404</p>
        <h1 className="page-title mt-2">{t('notfound.title')}</h1>
      </div>
    </section>
  );
}
