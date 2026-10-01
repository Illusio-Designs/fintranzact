/**
 * Small static pictures of each invoice design for the picker: the same
 * structure, colours and proportions as the printed page (title band,
 * boxes, table header, totals), drawn with plain blocks. Decorative only —
 * the option's name and description carry the meaning.
 */
import type { CSSProperties, ReactNode } from "react";
import type { InvoiceTemplate } from "@fintranzact/shared";

const INK = "#1f2937";
const MUTED = "#c7ccd4";
const FAINT = "#e5e7eb";

function Bar({ w = "100%", h = 2, c = MUTED, style }: { w?: string | number; h?: number; c?: string; style?: CSSProperties }) {
  return <div style={{ width: w, height: h, background: c, borderRadius: 1, ...style }} />;
}

function Lines({ n, w = ["100%", "80%", "60%"], h = 2, c = MUTED, gap = 2 }: { n: number; w?: string[]; h?: number; c?: string; gap?: number }) {
  return (
    <div style={{ display: "grid", gap }}>
      {Array.from({ length: n }, (_, i) => <Bar key={i} w={w[i % w.length]} h={h} c={c} />)}
    </div>
  );
}

function Rows({ n, zebra, line = FAINT, h = 5, cols = 4 }: { n: number; zebra?: string; line?: string; h?: number; cols?: number }) {
  return (
    <div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ height: h, display: "flex", alignItems: "center", gap: 3, padding: "0 2px", borderBottom: `0.5px solid ${line}`, background: zebra && i % 2 ? zebra : undefined }}>
          <Bar w="38%" h={1.5} />
          {Array.from({ length: cols - 1 }, (_, k) => <Bar key={k} w={`${50 / (cols - 1)}%`} h={1.5} c={FAINT} style={{ marginLeft: "auto" }} />)}
        </div>
      ))}
    </div>
  );
}

function Paper({ children, kind = "a4", bg = "#fff", pad = 6 }: { children: ReactNode; kind?: "a4" | "landscape" | "a5"; bg?: string; pad?: number }) {
  const size = kind === "landscape" ? { width: 150, height: 106 } : kind === "a5" ? { width: 88, height: 124 } : { width: 106, height: 150 };
  return (
    <div
      style={{ ...size, background: bg, padding: pad, boxShadow: "0 1px 2px rgba(20,30,50,.12), 0 4px 12px rgba(20,30,50,.10)", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column", gap: 4 }}
    >
      {children}
    </div>
  );
}

function Classic() {
  return (
    <Paper>
      <div style={{ height: 8, background: "#4f46e5" }} />
      <div style={{ display: "flex", gap: 4, border: `0.5px solid ${MUTED}`, padding: 3 }}>
        <div style={{ flex: 1.2 }}><Lines n={4} /></div>
        <div style={{ flex: 1 }}><Lines n={3} w={["70%"]} /></div>
      </div>
      <div style={{ height: 5, background: "#f3f4f6" }} />
      <Rows n={5} zebra="#f9fafb" />
      <div style={{ marginLeft: "auto", width: "45%" }}><Lines n={3} /><Bar h={3} c="#4f46e5" style={{ marginTop: 2 }} /></div>
    </Paper>
  );
}

function Tally() {
  const box = { border: `0.6px solid ${INK}` };
  return (
    <Paper>
      <Bar w="40%" h={3} c={INK} style={{ margin: "0 auto" }} />
      <div style={{ ...box, display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr" }}>
        <div style={{ gridRow: "span 2", padding: 2, borderRight: `0.6px solid ${INK}` }}><Lines n={4} c="#9ca3af" /></div>
        <div style={{ height: 9, borderRight: `0.6px solid ${INK}`, borderBottom: `0.6px solid ${INK}` }} />
        <div style={{ height: 9, borderBottom: `0.6px solid ${INK}` }} />
        <div style={{ height: 9, borderRight: `0.6px solid ${INK}` }} />
        <div style={{ height: 9, display: "flex", alignItems: "center", paddingLeft: 2 }}><div style={{ width: 7, height: 7, background: INK }} /></div>
      </div>
      <div style={{ ...box, flex: 1, display: "flex" }}>
        {[0.6, 3, 1, 1, 1, 1.4].map((f, i) => (
          <div key={i} style={{ flex: f, borderRight: i < 5 ? `0.6px solid ${INK}` : undefined, display: "grid", alignContent: "start", gap: 3, paddingTop: 7, paddingInline: 1 }}>
            <div style={{ position: "relative", top: -6, height: 0.6, background: INK, marginInline: -1 }} />
            {i === 1 && <Lines n={4} c="#9ca3af" />}
          </div>
        ))}
      </div>
      <div style={{ ...box, display: "flex", height: 16 }}>
        <div style={{ flex: 1.2, borderRight: `0.6px solid ${INK}` }} />
        <div style={{ flex: 1 }} />
      </div>
    </Paper>
  );
}

function Modern() {
  const acc = "#1f6f5c";
  return (
    <Paper>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 11, height: 11, borderRadius: 3, background: acc }} />
        <div style={{ flex: 1 }}><Lines n={2} w={["70%", "50%"]} /></div>
        <Bar w={30} h={5} c={acc} />
      </div>
      <Bar h={2.5} c={acc} />
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ flex: 1, height: 18, background: "#f2f7f5", borderRadius: 2 }} />)}
      </div>
      <div style={{ height: 6, background: acc }} />
      <Rows n={5} zebra="#f7faf9" line="#e3ebe8" />
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ flex: 1.2 }}><Lines n={3} /></div>
        <div style={{ flex: 1 }}><Lines n={2} /><div style={{ height: 6, background: acc, marginTop: 2 }} /></div>
      </div>
    </Paper>
  );
}

function Letterhead() {
  const acc = "#6b1d2a";
  return (
    <Paper>
      <Bar w="70%" h={5} c={acc} style={{ margin: "2px auto 0" }} />
      <Bar w="55%" h={1.5} style={{ margin: "0 auto" }} />
      <div style={{ borderTop: `0.6px solid ${acc}`, borderBottom: `0.6px solid ${acc}`, height: 2 }} />
      <Bar w="35%" h={2.5} c={INK} style={{ margin: "3px auto" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}><Lines n={3} /></div>
        <div style={{ flex: 1 }}><Lines n={4} w={["90%"]} /></div>
      </div>
      <div style={{ borderTop: `0.6px solid ${INK}`, borderBottom: `0.6px solid ${INK}`, height: 5 }} />
      <Rows n={4} line="#e6e1e2" />
      <div style={{ marginLeft: "auto", width: "46%" }}><Lines n={3} /><div style={{ borderTop: `0.6px solid ${INK}`, borderBottom: `1.6px double ${INK}`, height: 4, marginTop: 2 }} /></div>
      <div style={{ position: "absolute", left: 6, right: 6, bottom: 5, borderTop: `0.6px solid ${acc}` }} />
    </Paper>
  );
}

function Bold() {
  return (
    <Paper pad={0}>
      <div style={{ background: "#1b1b3a", padding: 6, display: "grid", gap: 3 }}>
        <Bar w="45%" h={7} c="#ffffff" />
        <div style={{ display: "flex", gap: 5 }}>
          <Bar w={18} h={4} c="#ffffff" />
          <Bar w={18} h={4} c="#ffffff" />
          <Bar w={22} h={4} c="#ffb199" />
        </div>
      </div>
      <div style={{ padding: "0 6px", display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1 }}><Bar w="40%" h={1.5} c="#e4572e" /><Lines n={3} /></div>
          <div style={{ flex: 1 }}><Bar w="40%" h={1.5} c="#e4572e" /><Lines n={3} /></div>
        </div>
        <Bar h={1.2} c="#1b1b3a" />
        <Rows n={4} h={8} line="#eeeeee" />
        <div style={{ marginLeft: "auto" }}><Bar w={40} h={7} c="#1b1b3a" /></div>
      </div>
    </Paper>
  );
}

function Minimal() {
  return (
    <Paper pad={9}>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}><Bar w={30} h={4} c="#9ca3af" /><Bar w={24} h={4} c="#3b5eaa" /></div>
      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ flex: 1 }}><Lines n={3} c={FAINT} /></div>)}
      </div>
      <Bar h={0.8} c={INK} style={{ marginTop: 6 }} />
      <Rows n={4} h={8} line="transparent" />
      <div style={{ marginLeft: "auto", width: "42%", borderTop: `0.6px solid ${INK}`, paddingTop: 2 }}><Lines n={2} c={FAINT} /><Bar h={3} c={INK} style={{ marginTop: 2 }} /></div>
      <div style={{ position: "absolute", left: 9, right: 9, bottom: 7 }}><Bar h={1.2} c={FAINT} /></div>
    </Paper>
  );
}

function Dense() {
  return (
    <Paper pad={5}>
      <div style={{ display: "flex", border: "0.6px solid #333", height: 18 }}>
        {[1.2, 1, 1].map((f, i) => <div key={i} style={{ flex: f, borderRight: i < 2 ? "0.6px solid #333" : undefined, padding: 2 }}><Lines n={3} /></div>)}
      </div>
      <div style={{ height: 4, background: "#333" }} />
      <div style={{ border: "0.6px solid #999", flex: 1, backgroundImage: "repeating-linear-gradient(90deg, transparent 0 7px, #c9cdd3 7px 7.6px), repeating-linear-gradient(180deg, #eceff3 0 5px, #fff 5px 6px, #fafbfc 6px 10px)" }} />
      <div style={{ display: "flex", gap: 3 }}>
        <div style={{ flex: 1.4, height: 16, border: "0.6px solid #999", background: "repeating-linear-gradient(180deg, #fff 0 4px, #c9cdd3 4px 4.6px)" }} />
        <div style={{ flex: 1, height: 16, border: "0.6px solid #999" }} />
      </div>
    </Paper>
  );
}

function Landscape() {
  return (
    <Paper kind="landscape" pad={5}>
      <div style={{ display: "flex", border: `0.6px solid ${INK}`, height: 20 }}>
        {[1.1, 1, 1, 0.9].map((f, i) => <div key={i} style={{ flex: f, borderRight: i < 3 ? `0.6px solid ${INK}` : undefined, padding: 2 }}><Lines n={3} /></div>)}
      </div>
      <div style={{ border: `0.6px solid ${INK}`, flex: 1, backgroundImage: "repeating-linear-gradient(90deg, transparent 0 8px, #9ca3af 8px 8.6px), linear-gradient(180deg, #f0f0f0 0 5px, #fff 5px)" }} />
      <div style={{ display: "flex", border: `0.6px solid ${INK}`, height: 18 }}>
        {[1.6, 1, 1].map((f, i) => <div key={i} style={{ flex: f, borderRight: i < 2 ? `0.6px solid ${INK}` : undefined, padding: 2 }}><Lines n={2} /></div>)}
      </div>
    </Paper>
  );
}

function CompactA5() {
  return (
    <Paper kind="a5" pad={6}>
      <Bar w="60%" h={4} c={INK} style={{ margin: "0 auto" }} />
      <Bar w="80%" h={1.5} style={{ margin: "0 auto" }} />
      <Bar h={0.6} c={INK} />
      <div style={{ display: "flex", justifyContent: "space-between" }}><Bar w="30%" h={2} /><Bar w="20%" h={2} /></div>
      <div style={{ borderTop: "0.6px dashed #888" }} />
      <Rows n={4} line="#bbbbbb" />
      <div style={{ display: "flex", alignItems: "end", gap: 4, marginTop: 2 }}>
        <div style={{ flex: 1 }}><Lines n={2} /></div>
        <div style={{ width: 30, height: 9, border: `1.2px solid ${INK}` }} />
      </div>
    </Paper>
  );
}

function Service() {
  const acc = "#5b3fa3";
  return (
    <Paper>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ flex: 1 }}><Bar w="70%" h={5} c={INK} /><Lines n={2} /></div>
        <div style={{ width: 36, height: 20, background: "#f3f0fb", border: "0.6px solid #ddd3f3", borderRadius: 3, display: "grid", placeItems: "center" }}><Bar w={24} h={5} c={acc} /></div>
      </div>
      <div style={{ display: "flex", gap: 3, borderTop: "0.6px solid #e6e1f3", borderBottom: "0.6px solid #e6e1f3", padding: "3px 0" }}>
        {[0, 1, 2, 3].map((i) => <div key={i} style={{ flex: 1 }}><Lines n={2} c={FAINT} /></div>)}
      </div>
      <Bar h={0.6} c="#cfc6e8" />
      <Rows n={3} h={9} line="#f0edf8" />
      <div style={{ marginLeft: "auto", width: "42%" }}><Lines n={3} /></div>
      <div style={{ height: 18, background: "#faf9fd", border: "0.6px solid #ece7f7", borderRadius: 3, display: "flex", alignItems: "center", padding: 3, gap: 3 }}>
        <div style={{ width: 11, height: 11, background: INK }} />
        <div style={{ flex: 1 }}><Lines n={2} /></div>
      </div>
    </Paper>
  );
}

const THUMBNAILS: Record<InvoiceTemplate, () => ReactNode> = {
  classic: Classic,
  tally: Tally,
  modern: Modern,
  letterhead: Letterhead,
  bold: Bold,
  minimal: Minimal,
  dense: Dense,
  landscape: Landscape,
  compact_a5: CompactA5,
  service: Service,
};

export function InvoiceDesignThumbnail({ template }: { template: InvoiceTemplate }) {
  const Thumb = THUMBNAILS[template];
  return (
    <div aria-hidden="true" data-testid={`invoice-design-thumb-${template}`} className="h-[158px] w-full flex items-center justify-center bg-[#e9edf4] dark:bg-surface-2 rounded-t-lg overflow-hidden">
      <Thumb />
    </div>
  );
}
