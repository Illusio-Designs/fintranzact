/**
 * Pagination — page bar above and below paginated lists
 *
 * Pagination appears at the bottom of every paginated list in Fintranzact —
 * invoices, parties, items, expenses.  Correctness here directly impacts
 * usability: a disabled Prev button on page 1 prevents navigating to a
 * non-existent page 0; a disabled Next on the last page prevents an empty
 * results fetch.  The "1–20 of 50" range helps the user understand
 * where they are in the full dataset without having to count pages.
 *
 * These tests verify:
 *   1. The component renders null when totalPages <= 1 so single-page lists
 *      don't show unnecessary navigation chrome.
 *   2. The "1–20 of 50" range text is computed correctly from page, pageSize
 *      and total, including boundary conditions (last page with a partial
 *      page of results).
 *   3. The Prev button is disabled on page 1 to prevent navigating to page 0.
 *   4. The Next button is disabled on the last page to prevent overfetch.
 *   5. Clicking Prev calls onPageChange(page - 1), decrementing the page.
 *   6. Clicking Next calls onPageChange(page + 1), incrementing the page.
 *   7. Page numbers jump straight to a page; the current one is marked.
 *   8. Neither button is disabled on a middle page, allowing free navigation.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination, pageList } from "../Pagination";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders a Pagination component.  Defaults represent a common scenario:
 * 50 invoices, 20 per page (3 pages), currently on page 2.
 * Individual tests override only the props they need.
 */
function renderPagination(
  props: Partial<React.ComponentProps<typeof Pagination>> = {}
) {
  const defaults: React.ComponentProps<typeof Pagination> = {
    page: 2,
    totalPages: 3,
    total: 50,
    pageSize: 20,
    onPageChange: vi.fn(),
  };
  return render(<Pagination {...defaults} {...props} />);
}

// ─── Null rendering ───────────────────────────────────────────────────────────

describe("Pagination — prev/next navigation bar for paginated lists", () => {
  describe("null rendering when pagination is unnecessary", () => {
    it("returns null when totalPages is 1, avoiding navigation chrome for single-page results", () => {
      const { container } = renderPagination({
        page: 1,
        totalPages: 1,
        total: 8,
        pageSize: 20,
      });

      expect(container.firstChild).toBeNull();
    });

    it("returns null when totalPages is 0 (empty dataset), so empty lists show no pagination bar", () => {
      const { container } = renderPagination({
        page: 1,
        totalPages: 0,
        total: 0,
        pageSize: 20,
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders the component when totalPages is 2, since navigation is meaningful with more than one page", () => {
      renderPagination({ page: 1, totalPages: 2, total: 25, pageSize: 20 });

      // At least one of the nav buttons must be present.
      expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    });
  });

  // ─── Range text ────────────────────────────────────────────────

  describe("range text: which rows are on screen", () => {
    it("shows 1–20 of 50 on the first page", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });
      expect(screen.getByText("1–20 of 50")).toBeInTheDocument();
    });

    it("caps the end at the total on the last, partial page: 41–50, not 41–60", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });
      expect(screen.getByText("41–50 of 50")).toBeInTheDocument();
    });

    it("writes large totals the Indian way", () => {
      renderPagination({ page: 1, totalPages: 500, total: 12500, pageSize: 25 });
      expect(screen.getByText("1–25 of 12,500")).toBeInTheDocument();
    });
  });

  describe("Prev button disabled state", () => {
    it("disables the Prev button on page 1 to prevent navigating to a non-existent page 0", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
    });

    it("enables the Prev button on page 2 so the user can navigate back to page 1", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
    });

    it("enables the Prev button on the last page so the user can navigate backwards freely", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
    });
  });

  // ─── Next button disabled state ───────────────────────────────────────────

  describe("Next button disabled state", () => {
    it("disables the Next button on the last page to prevent fetching an empty page beyond the dataset", () => {
      renderPagination({ page: 3, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });

    it("enables the Next button on page 1 so the user can advance to page 2", () => {
      renderPagination({ page: 1, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });

    it("enables the Next button on a middle page so the user can continue navigating forward", () => {
      renderPagination({ page: 2, totalPages: 3, total: 50, pageSize: 20 });

      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });
  });

  // ─── Neither button disabled on middle pages ──────────────────────────────

  describe("middle page — both buttons enabled for free navigation", () => {
    it("neither Prev nor Next is disabled on a middle page (page 2 of 4), allowing movement in both directions", () => {
      renderPagination({ page: 2, totalPages: 4, total: 80, pageSize: 20 });

      expect(screen.getByRole("button", { name: /prev/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
    });
  });

  // ─── onPageChange callbacks ───────────────────────────────────────────────

  describe("onPageChange callbacks triggered by button clicks", () => {
    it("calls onPageChange with page-1 when Prev is clicked, decrementing the current page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 2,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).toHaveBeenCalledOnce();
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("calls onPageChange with page+1 when Next is clicked, advancing to the next page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 2,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(onPageChange).toHaveBeenCalledOnce();
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it("does not call onPageChange when the disabled Prev button is clicked on page 1", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 1,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      // userEvent respects the disabled attribute — click should not fire the handler.
      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("does not call onPageChange when the disabled Next button is clicked on the last page", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 3,
        totalPages: 3,
        total: 50,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it("passes the correct page number from page 3 going back: onPageChange(2)", async () => {
      const onPageChange = vi.fn();
      renderPagination({
        page: 3,
        totalPages: 5,
        total: 100,
        pageSize: 20,
        onPageChange,
      });

      await userEvent.click(screen.getByRole("button", { name: /prev/i }));

      expect(onPageChange).toHaveBeenCalledWith(2);
    });
  });

  // ─── Page indicator text ──────────────────────────────────────────────────

  describe("page numbers", () => {
    it("marks the current page so screen readers announce it", () => {
      renderPagination({ page: 2, totalPages: 3 });
      expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("button", { name: "Page 1" })).not.toHaveAttribute("aria-current");
    });

    it("jumps straight to a page when its number is clicked", async () => {
      const onPageChange = vi.fn();
      renderPagination({ page: 1, totalPages: 3, onPageChange });
      await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it("shortens long lists to first, last and the pages around the current one", () => {
      expect(pageList(1, 20)).toEqual([1, 2, 3, 4, 5, "…", 20]);
      expect(pageList(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
      expect(pageList(20, 20)).toEqual([1, "…", 16, 17, 18, 19, 20]);
      expect(pageList(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe("rows per page", () => {
    it("offers 10, 25, 50 and 100 rows and reports the choice", async () => {
      const onPageSizeChange = vi.fn();
      renderPagination({ page: 1, totalPages: 2, total: 40, pageSize: 25, onPageSizeChange });
      await userEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
      await userEvent.click(screen.getByRole("option", { name: "50" }));
      expect(onPageSizeChange).toHaveBeenCalledWith(50);
    });

    it("is shown even when everything fits on one page, so a smaller page can be picked", () => {
      renderPagination({ page: 1, totalPages: 1, total: 18, pageSize: 25, onPageSizeChange: vi.fn() });
      expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    });
  });

  describe("top bar", () => {
    it("goes to the page picked in the Page box", async () => {
      const onPageChange = vi.fn();
      renderPagination({ page: 1, totalPages: 3, onPageChange, placement: "top" });
      await userEvent.click(screen.getByRole("combobox", { name: "Go to page" }));
      await userEvent.click(screen.getByRole("option", { name: "3" }));
      expect(onPageChange).toHaveBeenCalledWith(3);
    });
  });

});
