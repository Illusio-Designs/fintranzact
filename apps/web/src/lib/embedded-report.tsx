import { createContext, useContext, type ReactNode } from "react";

/**
 * Set when a full page (GST Returns, GSTR-2B, ITC, e-Invoicing, e-Way Bills)
 * is shown inside the Reports Centre. The Centre draws the title, so the
 * page's own header shows only its action buttons; `gstTab` pins the GST
 * page to one return.
 */
interface Embedded {
  gstTab?: "gstr1" | "gstr3b" | "gstr9" | "cmp08" | "gstr4";
}

const EmbeddedReportContext = createContext<Embedded | null>(null);

export function EmbeddedReport({ children, ...value }: Embedded & { children: ReactNode }) {
  return <EmbeddedReportContext.Provider value={value}>{children}</EmbeddedReportContext.Provider>;
}

export function useEmbeddedReport() {
  return useContext(EmbeddedReportContext);
}
