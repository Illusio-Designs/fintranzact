import { Link } from "@tanstack/react-router";

/**
 * Shown in the chat panel when the questions have run out, and only while extra
 * questions can be bought (the caller checks `aiCanBuy()`). The owner gets a
 * link to Settings, Billing, where the packs are bought; everyone else is told
 * to ask the owner (billing is the owner's).
 */
export function AiBuyMore({ isOwner, onNavigate }: { isOwner: boolean; onNavigate?: () => void }) {
  return (
    <div data-testid="ai-buy-more" className="mx-3 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-light bg-surface-1 px-3 py-2 text-xs text-text-secondary">
      {isOwner ? (
        <>
          <span>Need more questions? Extra packs of 100 never expire.</span>
          <Link to="/settings" search={{ tab: "billing" }} onClick={onNavigate} className="btn-primary px-3 py-1.5 text-xs">
            Buy more questions
          </Link>
        </>
      ) : (
        <span data-testid="ai-ask-owner">Ask your owner to buy more questions from Settings, Billing.</span>
      )}
    </div>
  );
}
