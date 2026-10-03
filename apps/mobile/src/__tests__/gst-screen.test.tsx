/**
 * The mobile GST Returns screen: period picker, return status, and who sees the file button.
 * A read-only role (auditor, accountant, seller) sees the status and no file button.
 */
import React from "react";
import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme as render } from "../test-utils";
import { useBusinessStore } from "../stores/business";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockState: { role: string; biz: any; status: any; attempt: any } = { role: "owner", biz: null, status: null, attempt: null };

jest.mock("../lib/trpc", () => {
  const q = (read: () => unknown) => ({ useQuery: () => ({ data: read(), isLoading: false, error: null, refetch: async () => ({}) }) });
  return {
    trpc: {
      auth: { me: q(() => ({ role: mockState.role })) },
      business: { getById: q(() => mockState.biz) },
      gstReturns: { filingStatus: q(() => mockState.status), filingAttempt: q(() => mockState.attempt) },
    },
  };
});
jest.mock("../components/gst/GstFilingFlow", () => {
  const { Text: T } = require("react-native");
  return { GstFilingFlow: (p: { kind: string; year: number; month: number }) => <T>{`FLOW ${p.kind} ${p.year}-${p.month}`}</T> };
});

import GSTReturnsScreen from "../../app/(app)/(more)/gst";

const filed = (arn: string) => ({ arn, filedOn: "2026-05-11", mode: "GSP", valid: true, status: "Filed", rawType: "GSTR1" });

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-10T10:00:00Z"));
  mockState.role = "owner";
  mockState.biz = { gstin: "27ABCDE1234F1Z5", gstRegistrationType: "regular" };
  mockState.status = {
    status: "ok", reason: null, financialYear: "FY 2026-27", composition: false, cached: false, fetchedAt: 1,
    months: [{ period: "082026", label: "Aug 2026", gstr1: filed("ARN-1"), gstr3b: null, others: [] }],
  };
  mockState.attempt = { state: "draft" };
  useBusinessStore.setState({ businessId: "biz1", businessName: "Biz" });
});
afterEach(() => jest.useRealTimers());

describe("GST Returns screen", () => {
  it("starts on last month, shows the status in words, and offers to file", () => {
    render(<GSTReturnsScreen />);
    expect(screen.getByLabelText("Return period Aug 2026")).toBeTruthy();
    expect(screen.getByText("Filed, ARN ARN-1")).toBeTruthy();
    expect(screen.getByText("Not filed")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "File GSTR-1 for Aug 2026" }));
    expect(screen.getByText("FLOW gstr1 2026-8")).toBeTruthy();
  });

  it("moves between months and returns", () => {
    render(<GSTReturnsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByLabelText("Return period Jul 2026")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "GSTR-3B" }));
    expect(screen.getByRole("button", { name: "File GSTR-3B for Jul 2026" })).toBeTruthy();
  });

  it("says Resume when an attempt is under way", () => {
    mockState.attempt = { state: "saved" };
    render(<GSTReturnsScreen />);
    expect(screen.getByRole("button", { name: "Resume GSTR-1 filing" })).toBeTruthy();
  });

  it.each(["auditor", "accountant", "seller"])("%s sees the status but no file button", (role) => {
    mockState.role = role;
    render(<GSTReturnsScreen />);
    expect(screen.getByText("Filed, ARN ARN-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /File GSTR|Resume|View GSTR/ })).toBeNull();
    expect(screen.getByText(/cannot file returns/)).toBeTruthy();
  });

  it("ca_filing may file", () => {
    mockState.role = "ca_filing";
    render(<GSTReturnsScreen />);
    expect(screen.getByRole("button", { name: "File GSTR-1 for Aug 2026" })).toBeTruthy();
  });

  it("without a GSTIN there is nothing to file", () => {
    mockState.biz = { gstin: "", gstRegistrationType: "unregistered" };
    render(<GSTReturnsScreen />);
    expect(screen.getByText(/Add the business GSTIN in Settings/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /File GSTR/ })).toBeNull();
  });

  it("composition dealers are pointed to the web app", () => {
    mockState.biz = { gstin: "27ABCDE1234F1Z5", gstRegistrationType: "composition" };
    render(<GSTReturnsScreen />);
    expect(screen.getByText(/Composition dealers file CMP-08/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /File GSTR/ })).toBeNull();
  });
});

