import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";

export type BarcodeType = "ean13" | "code128" | "qr";

export const BARCODE_TYPE_NAMES: Record<BarcodeType, string> = {
  ean13: "EAN-13",
  code128: "Code 128",
  qr: "QR code",
};

/** The business's barcode setup (on/off, type, one-or-many, label size). */
export function useBarcodeSetup() {
  const query = trpc.barcode.setup.useQuery(undefined, { staleTime: 60_000 });
  return { data: query.data, isLoading: query.isLoading };
}

/**
 * A barcode drawn from the server's encoder — the same bars the printed label
 * gets — as crisp SVG. Scales to the given width; QR codes stay square.
 */
export function BarcodeSymbol({
  code,
  type,
  width = 180,
  height = 56,
  showText = true,
  className,
}: {
  code: string;
  type?: BarcodeType;
  width?: number;
  height?: number;
  showText?: boolean;
  className?: string;
}) {
  const { data, isError } = trpc.barcode.symbol.useQuery(
    { code, type },
    { enabled: !!code.trim(), staleTime: Infinity, placeholderData: keepPreviousData, retry: false },
  );

  if (!code.trim() || isError) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-surface-2 text-xs text-text-tertiary ${className ?? ""}`}
        style={{ width, height }}
      >
        {isError ? "Can't draw this code" : "No code"}
      </div>
    );
  }
  if (!data) return <div className={`skeleton rounded ${className ?? ""}`} style={{ width, height }} />;

  if (data.kind === "matrix") {
    const size = data.rows.length;
    const side = Math.min(width, height);
    return (
      <svg
        role="img"
        aria-label={`QR code ${data.text}`}
        className={className}
        width={side}
        height={side}
        viewBox={`-2 -2 ${size + 4} ${size + 4}`}
        shapeRendering="crispEdges"
      >
        <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
        {data.rows.map((row, r) =>
          [...row].map((bit, c) => (bit === "1" ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null)),
        )}
      </svg>
    );
  }

  const modules = data.modules;
  const barsH = showText ? height - 12 : height;
  const bars: Array<{ x: number; w: number }> = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] === "1") {
      let j = i;
      while (j < modules.length && modules[j] === "1") j++;
      bars.push({ x: i, w: j - i });
      i = j;
    } else i++;
  }
  return (
    <div className={`inline-flex flex-col items-center bg-white ${className ?? ""}`} style={{ width }}>
      <svg
        role="img"
        aria-label={`${BARCODE_TYPE_NAMES[data.type]} ${code}`}
        width={width}
        height={barsH}
        viewBox={`0 0 ${modules.length} ${barsH}`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
      >
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={barsH} fill="#000" />
        ))}
      </svg>
      {showText && (
        <span className="font-mono text-2xs leading-3 text-black tracking-wide">{data.text}</span>
      )}
    </div>
  );
}
