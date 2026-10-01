# Fintranzact interface system

The rules the web app follows. Read this before building or changing UI; the
design skills in `.claude/skills/` (interface-design, ui-ux-pro-max,
impeccable, web-design-guidelines, frontend-design) read it too.

## Direction
Operate mode: people come to finish a task (bill, collect, file GST). Calm,
dense enough for long lists, navy-blue brand, one accent. Colour means
something (status, money at risk), never decoration. Signature detail:
totals get the ledger double underline.

## Type
- Families: DM Sans Variable (UI), Plus Jakarta Sans (display headings),
  JetBrains Mono (document numbers, codes). Bundled with @fontsource, no
  Google Fonts.
- Scale (Tailwind): `text-2xs` 11 · `text-xs` 12 · `text-ui` 13 · `text-sm` 14
  · `text-base` 16, then lg/xl/2xl. Do not write `text-[NNpx]` in app UI.
- Numbers in tables and totals: `tabular-nums`, right-aligned.
- "…" not "...", "Loading…" / "Saving…".

## Radius
Three steps: controls `rounded-lg` 8px · cards `rounded-xl` 10px · panels and
dialogs `rounded-2xl` 14px. Pills and avatars `rounded-full`.

## Depth
Light: subtle shadow (`shadow-card`, `shadow-elevated`). Dark: borders only,
surfaces step up in lightness (`surface-1` page → `surface-0` card →
`surface-2`/`surface-3`). Don't mix strategies inside one component.

## Motion
Tokens in `styles/globals.css`: `--ease-out` cubic-bezier(0.23,1,0.32,1),
`--dur-press` 120 · `--dur-fast` 150 · `--dur-pop` 180 · `--dur-panel` 280.
- Buttons press to `scale(0.97)`.
- Only animate transform and opacity (width only for progress bars).
- Never `transition-all`. Reduced motion is honoured globally.
- Search, shortcuts and the command palette don't animate.

## Messages
Every message is a goey-toast through `toast()` in `hooks/useToast.ts`.
Full-page states (link not valid, failed to load) use EmptyState.

## Tables and lists
See the table gist: locked header and first column, sort by (menu + headers,
"then by"), filters as pills, status chips with counts, saved views,
pagination above (compact) and below (full: pages, rows per page 10/25/50/100,
go to), select across pages, Actions dropdowns for list / row / selection.
