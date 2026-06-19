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
      className="flex-1 rounded-xl border-2 border-slate-200 bg-white p-6 text-left transition-colors hover:border-teal-400 hover:bg-teal-50 disabled:opacity-60"
    >
      <div className="text-3xl">{icon}</div>
      <div className="mt-3 text-base font-semibold text-slate-800">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{hint}</div>
    </button>
  );
}
