import { apiUrl } from "@/lib/api-url";
import { getBusinessId } from "@/lib/trpc";

/**
 * Fetch a PDF from the API (signed in, for the active business) and open it
 * in a new tab for printing; downloads it instead when pop-ups are blocked.
 */
export async function openPdf(path: string, filename: string): Promise<void> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "x-business-id": getBusinessId() || "" },
  });
  if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
