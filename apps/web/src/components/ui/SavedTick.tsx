/** "✓ Saved" for a save button, the tick drawing itself in. */
export function SavedTick({ label = "Saved" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
        <path
          d="M3 8.5l3.2 3L13 4.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="20"
          className="animate-check-draw"
        />
      </svg>
      {label}
    </span>
  );
}
