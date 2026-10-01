/**
 * Column auto-mapping for the import wizard's Tally / Generic CSV sources.
 *
 * myBillBook exports have fixed column names and a preset map. Other sources
 * do not, so a column is mapped to a field when its header names that field:
 * the field's label ("Party Name", "Opening Balance") or its key
 * ("openingBalance"), ignoring case, spaces and punctuation. Anything else is
 * left for the user to pick in the dropdowns.
 */
export type FieldDef = { key: string; label: string };

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildFieldNameMapping(headers: string[], fields: FieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of fields) {
    const names = new Set([norm(field.label), norm(field.key)]);
    // "Amount / Total Amount", "Party Name / Contact Name": either half names it.
    for (const part of field.label.split("/")) names.add(norm(part));
    names.delete("");
    const header = headers.find((h) => !used.has(h) && names.has(norm(h)));
    if (header) {
      mapping[field.key] = header;
      used.add(header);
    }
  }
  return mapping;
}
