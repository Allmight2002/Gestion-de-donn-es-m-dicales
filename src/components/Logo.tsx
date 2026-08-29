// Marque visuelle : tuile arrondie en degrade teal + glyphe "pouls" (registre clinique).
export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      className={`grid place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-800 text-white shadow-sm ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h3l2-5 4 10 2.5-6H21" />
      </svg>
    </span>
  );
}
