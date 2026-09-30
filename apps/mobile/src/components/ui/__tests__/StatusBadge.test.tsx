/**
 * Tests for `src/components/ui/StatusBadge.tsx`
 *
 * WHY these tests matter for contributors:
 * The StatusBadge is rendered on every invoice row in the app — potentially
 * hundreds of times in a single list. It is the primary visual signal that
 * tells a merchant at a glance whether a customer has paid, is overdue, or
 * needs follow-up. Incorrect colours or labels here directly cause merchants
 * to miss overdue collections, which is a core value-proposition failure.
 *
 * The badge takes its colours from the active theme (src/lib/theme.ts), so
 * these tests compare against the palette rather than hard-coded hex values:
 *   - paid / delivered → success
 *   - overdue → danger
 *   - partial / pending → warning
 *   - sent / confirmed → brand
 *   - draft → secondary text, cancelled → muted text
 *   - unknown status → shows its own name in neutral colours, never "Draft"
 */

import React from "react";
import { StyleSheet } from "react-native";
import { renderWithTheme, screen } from "../../../test-utils";
import { darkColors, lightColors } from "../../../lib/theme";
import { StatusBadge } from "../StatusBadge";

function textColor(label: string): string | undefined {
  return StyleSheet.flatten(screen.getByText(label).props.style)?.color as string | undefined;
}

describe("StatusBadge — invoice/order status indicator", () => {
  it("renders the label 'Paid' in the success colour", () => {
    // WHY: If paid is red or amber, merchants chase invoices that are already paid.
    renderWithTheme(<StatusBadge status="paid" />);
    expect(textColor("Paid")).toBe(darkColors.success);
  });

  it("renders 'Overdue' in the danger colour", () => {
    // WHY: Overdue is the call to action; it must never look like success.
    renderWithTheme(<StatusBadge status="overdue" />);
    expect(textColor("Overdue")).toBe(darkColors.danger);
  });

  it("renders 'Partial' and 'Pending' in the warning colour", () => {
    renderWithTheme(
      <>
        <StatusBadge status="partial" />
        <StatusBadge status="pending" />
      </>,
    );
    expect(textColor("Partial")).toBe(darkColors.warning);
    expect(textColor("Pending")).toBe(darkColors.warning);
  });

  it("renders 'Sent' in the brand colour", () => {
    renderWithTheme(<StatusBadge status="sent" />);
    expect(textColor("Sent")).toBe(darkColors.brand);
  });

  it("renders 'Draft' and 'Cancelled' in neutral text colours", () => {
    renderWithTheme(
      <>
        <StatusBadge status="draft" />
        <StatusBadge status="cancelled" />
      </>,
    );
    expect(textColor("Draft")).toBe(darkColors.textSecondary);
    expect(textColor("Cancelled")).toBe(darkColors.textMuted);
  });

  it("renders 'Delivered' for order fulfilment in the success colour", () => {
    renderWithTheme(<StatusBadge status="delivered" />);
    expect(textColor("Delivered")).toBe(darkColors.success);
  });

  it("follows the light palette in light mode", () => {
    // WHY: The same badge must stay readable on white cards.
    renderWithTheme(<StatusBadge status="overdue" />, { mode: "light" });
    expect(textColor("Overdue")).toBe(lightColors.danger);
  });

  it("shows an unknown status by name instead of pretending it is a draft", () => {
    // WHY: A new API status should read as itself, not as a misleading "Draft".
    renderWithTheme(<StatusBadge status="archived" />);
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("paints a pill background behind the label", () => {
    renderWithTheme(<StatusBadge status="paid" />);
    const pill = screen.getByText("Paid").parent?.parent;
    const bg = StyleSheet.flatten(pill?.props.style)?.backgroundColor;
    expect(bg).toBe(darkColors.successBg);
  });
});
