interface WorkflowStep {
  label: string;
  description?: string;
}
export function WorkflowSteps({ steps, current }: { steps: WorkflowStep[]; current: number }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label="Progression">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return (
          <li
            key={step.label}
            aria-current={active ? 'step' : undefined}
            className={`flex min-w-0 gap-3 rounded-xl border px-3 py-2.5 ${
              active
                ? 'border-teal-300 bg-teal-50/70'
                : complete
                  ? 'border-teal-100 bg-white'
                  : 'border-slate-200 bg-white/60'
            }`}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                active || complete ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {complete ? '✓' : number}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-sm font-medium ${active ? 'text-teal-900' : 'text-slate-700'}`}>{step.label}</span>
              {step.description && <span className="mt-0.5 hidden text-xs text-slate-500 lg:block">{step.description}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
