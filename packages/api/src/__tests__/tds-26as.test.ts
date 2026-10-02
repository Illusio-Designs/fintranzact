import { describe, it, expect } from "vitest";
import {
  matchPartyByName,
  nameSimilarity,
  reconcile26as,
  resolveParty,
  sectionFamily,
  type Tds26asBookIn,
  type Tds26asEntryIn,
  type Tds26asPartyIn,
} from "../lib/tds-26as.js";

const parties: Tds26asPartyIn[] = [
  { id: "p-acme", name: "Acme Industries Pvt Ltd" },
  { id: "p-zen", name: "Zenith Traders", legalName: "Zenith Trading Company" },
  { id: "p-ram", name: "Ramesh Kumar" },
  { id: "p-ram2", name: "Ramesh Kumar" },
];

let n = 0;
const entry = (o: Partial<Tds26asEntryIn>): Tds26asEntryIn => ({
  id: `e${++n}`, deductorTan: "MUMA12345B", deductorName: "Acme Industries Private Limited", section: "194C", quarter: 1,
  taxDeducted: "1000.00", partyId: null, status: "pending", ...o,
});
const book = (o: Partial<Tds26asBookIn>): Tds26asBookIn => ({ partyId: "p-acme", sectionCode: "194C", quarter: 1, amount: "1000.00", ...o });

describe("sectionFamily", () => {
  it("folds 26AS spellings and the books' split codes into one family", () => {
    for (const c of ["194J", "194J(a)", "194J(B)", "194JA", "194JB", "194J_TECH", "194J_PROF", " 194 J (b) "]) expect(sectionFamily(c)).toBe("194J");
    for (const c of ["194I", "194I(a)", "194I(b)", "194I_PM", "194I_LB"]) expect(sectionFamily(c)).toBe("194I");
  });
  it("keeps other sections, and 194IA (property) apart from 194I", () => {
    expect(sectionFamily("194c")).toBe("194C");
    expect(sectionFamily("194IA")).toBe("194IA");
    expect(sectionFamily("194Q")).toBe("194Q");
  });
});

describe("name matching", () => {
  it("ignores Pvt/Ltd noise, case, punctuation and order", () => {
    expect(nameSimilarity("ACME Industries Private Limited", "Acme Industries Pvt. Ltd.")).toBe(1);
    expect(nameSimilarity("Industries Acme", "Acme Industries Pvt Ltd")).toBe(1);
    expect(nameSimilarity("Acme", "Zenith")).toBe(0);
  });
  it("matches a clear single customer, also by legal name", () => {
    expect(matchPartyByName("ACME INDUSTRIES PRIVATE LIMITED", parties)).toBe("p-acme");
    expect(matchPartyByName("Zenith Trading Co.", parties)).toBe("p-zen");
  });
  it("does not guess on weak or tied names", () => {
    expect(matchPartyByName("Acme Corp of Asia", parties)).toBeNull();
    expect(matchPartyByName("Ramesh Kumar", parties)).toBeNull(); // two customers tie
    expect(matchPartyByName(null, parties)).toBeNull();
  });
});

describe("resolveParty", () => {
  it("prefers the row's link, then a TAN link, then the name", () => {
    const tanLinks = new Map([["MUMA12345B", "p-zen"]]);
    expect(resolveParty({ partyId: "p-ram", deductorTan: "MUMA12345B", deductorName: "Acme" }, tanLinks, parties)).toEqual({ partyId: "p-ram", via: "link" });
    expect(resolveParty({ partyId: null, deductorTan: "MUMA12345B", deductorName: "Acme Industries" }, tanLinks, parties)).toEqual({ partyId: "p-zen", via: "tan" });
    expect(resolveParty({ partyId: null, deductorTan: "DELA00000A", deductorName: "Acme Industries" }, tanLinks, parties)).toEqual({ partyId: "p-acme", via: "name" });
    expect(resolveParty({ partyId: null, deductorTan: "DELA00000A", deductorName: "Nobody" }, tanLinks, parties)).toEqual({ partyId: null, via: null });
  });
});

describe("reconcile26as", () => {
  it("matches sums per customer, section family and quarter within tolerance", () => {
    const r = reconcile26as({
      entries: [entry({ taxDeducted: "600.00" }), entry({ taxDeducted: "400.50" })],
      parties,
      books: [book({ amount: "1000.00" })],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ status: "matched", partyId: "p-acme", matchedVia: "name", amount26as: "1000.50", booksAmount: "1000.00", difference: "0.50" });
    expect(r.counts.matched).toBe(1);
  });

  it("flags a difference beyond the tolerance (exactly 1.00 still matches)", () => {
    const at = reconcile26as({ entries: [entry({ taxDeducted: "1001.00" })], parties, books: [book({})] });
    expect(at.rows[0]!.status).toBe("matched");
    const over = reconcile26as({ entries: [entry({ taxDeducted: "1001.01" })], parties, books: [book({})] });
    expect(over.rows[0]).toMatchObject({ status: "amount_differs", difference: "1.01" });
    const custom = reconcile26as({ entries: [entry({ taxDeducted: "1005.00" })], parties, books: [book({})], tolerance: "10" });
    expect(custom.rows[0]!.status).toBe("matched");
  });

  it("sums the books' split 194J codes against one 26AS 194J row", () => {
    const r = reconcile26as({
      entries: [entry({ section: "194J(b)", taxDeducted: "1500.00" })],
      parties,
      books: [book({ sectionCode: "194J_PROF", amount: "1000.00" }), book({ sectionCode: "194J_TECH", amount: "500.00" })],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ status: "matched", section: "194J" });
  });

  it("keeps quarters apart", () => {
    const r = reconcile26as({
      entries: [entry({ quarter: 1 }), entry({ quarter: 2 })],
      parties,
      books: [book({ quarter: 1 })],
    });
    expect(r.rows.map((x) => [x.quarter, x.status])).toEqual([[1, "matched"], [2, "missing_in_books"]]);
  });

  it("reports 26AS rows with no customer or no books entry as missing_in_books, books-only as missing_in_26as", () => {
    const r = reconcile26as({
      entries: [
        entry({ deductorTan: "DELA00000A", deductorName: "Unknown Buyer", taxDeducted: "300.00" }),
        entry({ section: "194H", taxDeducted: "50.00" }), // Acme, but nothing in books for 194H
      ],
      parties,
      books: [book({ partyId: "p-zen", amount: "700.00", sectionCode: "194C" })],
    });
    const by = Object.fromEntries(r.rows.map((x) => [x.deductorTan ?? "books", x]));
    expect(by["DELA00000A"]).toMatchObject({ status: "missing_in_books", partyId: null, partyName: null });
    expect(r.rows.find((x) => x.section === "194H")!.status).toBe("missing_in_books");
    const only = r.rows.find((x) => x.status === "missing_in_26as")!;
    expect(only).toMatchObject({ partyId: "p-zen", booksAmount: "700.00", amount26as: "0.00", difference: "-700.00", entryIds: [] });
    expect(r.counts).toEqual({ matched: 0, amount_differs: 0, missing_in_books: 2, missing_in_26as: 1, ignored: 0 });
    expect(r.rows[r.rows.length - 1]!.status).toBe("missing_in_26as"); // books-only rows last
  });

  it("a manual link on one row resolves every row with that TAN", () => {
    const r = reconcile26as({
      entries: [
        entry({ deductorTan: "DELA00000A", deductorName: "D & Co", partyId: "p-zen", quarter: 1 }),
        entry({ deductorTan: "DELA00000A", deductorName: "D & Co", partyId: null, quarter: 2 }),
      ],
      parties,
      books: [book({ partyId: "p-zen", quarter: 1 }), book({ partyId: "p-zen", quarter: 2 })],
    });
    expect(r.rows.map((x) => [x.status, x.matchedVia])).toEqual([["matched", "link"], ["matched", "tan"]]);
  });

  it("leaves ignored rows out of the sums and the books-side match, but lists them", () => {
    const r = reconcile26as({
      entries: [entry({ taxDeducted: "1000.00" }), entry({ taxDeducted: "999.00", status: "ignored" })],
      parties,
      books: [book({})],
    });
    expect(r.rows.map((x) => x.status).sort()).toEqual(["ignored", "matched"]);
    expect(r.total26as).toBe("1000.00");
    expect(r.counts.ignored).toBe(1);
  });

  it("ignoring the only row for a books entry leaves the books entry missing in 26AS", () => {
    const r = reconcile26as({ entries: [entry({ status: "ignored" })], parties, books: [book({})] });
    expect(r.counts).toMatchObject({ ignored: 1, missing_in_26as: 1, matched: 0 });
    expect(r.totalBooks).toBe("1000.00");
  });

  it("is empty for no input", () => {
    const r = reconcile26as({ entries: [], parties: [], books: [] });
    expect(r.rows).toEqual([]);
    expect(r.total26as).toBe("0.00");
  });
});
