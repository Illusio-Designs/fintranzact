import { Link } from "@tanstack/react-router";
import { aiLinkHref, type AiAnyCard, type AiBarChartCard, type AiLinkCard, type AiTableCard } from "@fintranzact/shared";
import { AiConfirmationCardView } from "./AiConfirmationCard";

/**
 * The cards under an assistant answer. Only the four validated card types are
 * ever drawn, as plain text in real table / SVG / link elements: no HTML from
 * the model, and links only to the in-app routes `aiLinkHref` allows. The
 * confirmation card is built by the server from a stored pending action.
 */

const NUMBER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function formatValue(value: number, unit?: string): string {
  const n = NUMBER.format(value);
  if (!unit) return n;
  return unit.length <= 2 ? `${unit}${n}` : `${n} ${unit}`;
}

export function AiTable({ card }: { card: AiTableCard }) {
  return (
    <figure className="rounded-xl border border-border-light bg-surface-0" data-testid="ai-card-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[16rem] border-collapse text-left text-xs">
          {card.title && <caption className="px-3 pb-1 pt-2.5 text-left text-xs font-semibold text-text-primary">{card.title}</caption>}
          <thead>
            <tr className="border-b border-border-light text-text-tertiary">
              {card.columns.map((c, i) => (
                <th key={i} scope="col" className="px-3 py-1.5 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, r) => (
              <tr key={r} className="border-b border-border-light last:border-0">
                {card.columns.map((_, c) => (
                  <td key={c} className="px-3 py-1.5 align-top text-text-primary">{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
            {card.rows.length === 0 && (
              <tr><td colSpan={card.columns.length} className="px-3 py-2 text-text-tertiary">No rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

const ROW = 24;
const WIDTH = 320;
const LABEL_W = 84;
const VALUE_W = 78;

export function AiBarChart({ card }: { card: AiBarChartCard }) {
  const max = Math.max(...card.bars.map((b) => Math.abs(b.value)), 0) || 1;
  const trackW = WIDTH - LABEL_W - VALUE_W;
  const height = card.bars.length * ROW + 4;
  const summary = card.bars.map((b) => `${b.label} ${formatValue(b.value, card.unit)}`).join(", ");
  return (
    <figure className="rounded-xl border border-border-light bg-surface-0 px-3 py-2.5" data-testid="ai-card-chart">
      {card.title && <figcaption className="mb-1 text-xs font-semibold text-text-primary">{card.title}</figcaption>}
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`${card.title ?? "Bar chart"}: ${summary}`} className="h-auto w-full max-w-sm">
        <title>{card.title ?? "Bar chart"}</title>
        {card.bars.map((b, i) => {
          const w = Math.max(2, (Math.abs(b.value) / max) * trackW);
          const y = i * ROW + 2;
          return (
            <g key={i}>
              <text x={0} y={y + 14} className="fill-text-secondary text-[10px]">{b.label.length > 13 ? `${b.label.slice(0, 12)}…` : b.label}</text>
              <rect x={LABEL_W} y={y + 3} width={w} height={14} rx={3} className={b.value < 0 ? "fill-red-500" : "fill-brand-500"} />
              <text x={LABEL_W + w + 4} y={y + 14} className="fill-text-primary text-[10px] font-medium">{formatValue(b.value, card.unit)}</text>
            </g>
          );
        })}
      </svg>
      {/* The same numbers for screen readers. */}
      <table className="sr-only">
        <caption>{card.title ?? "Bar chart"}</caption>
        <thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {card.bars.map((b, i) => (
            <tr key={i}><td>{b.label}</td><td>{formatValue(b.value, card.unit)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function AiLink({ card, onNavigate }: { card: AiLinkCard; onNavigate?: () => void }) {
  const href = aiLinkHref(card);
  return (
    <Link
      to={href.to as never}
      search={href.search as never}
      onClick={onNavigate}
      className="inline-flex items-center gap-1 rounded-lg border border-border-light bg-surface-0 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-surface-1 hover:underline dark:text-brand-400"
      data-testid="ai-card-link"
    >
      {card.label}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export function AiCards({ cards, onNavigate }: { cards: AiAnyCard[]; onNavigate?: () => void }) {
  if (cards.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {cards.map((card, i) =>
        card.type === "confirmation" ? <AiConfirmationCardView key={card.actionId} card={card} onNavigate={onNavigate} />
        : card.type === "table" ? <AiTable key={i} card={card} />
        : card.type === "bar_chart" ? <AiBarChart key={i} card={card} />
        : <AiLink key={i} card={card} onNavigate={onNavigate} />,
      )}
    </div>
  );
}
