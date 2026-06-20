// Grand bouton-carte pour les ecrans de choix "Entrer moi-meme / Confier au staff".
export function ChoiceCard({
  icon,
  title,
  hint,
  onClick,
  disabled,
}: {
  icon: string;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex-1 rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md disabled:opacity-60"
    >
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-2xl ring-1 ring-inset ring-teal-600/15">{icon}</div>
      <div className="mt-4 text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{hint}</div>
      <div className="mt-3 text-sm font-medium text-teal-600 transition group-hover:translate-x-0.5">→</div>
    </button>
  );
}
