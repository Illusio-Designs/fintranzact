import { Logo } from "./Logo";

/** First load of the app (session, workspace): the logo over a shimmering bar instead of a spinner. */
export function BootSplash({ className = "bg-surface-0" }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading Fintranzact" className={`min-h-screen flex items-center justify-center ${className}`}>
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <Logo className="w-10 h-10" />
        <span aria-hidden className="skeleton block h-1.5 w-28 rounded-full" />
      </div>
    </div>
  );
}
