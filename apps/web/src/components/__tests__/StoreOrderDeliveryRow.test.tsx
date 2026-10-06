import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreOrderDeliveryRow } from "../StoreOrderDeliveryRow";

function renderRow(delivery?: { taxableValue: string; taxAmount: string; rate: string }) {
  return render(
    <table>
      <tfoot>
        <StoreOrderDeliveryRow delivery={delivery} />
      </tfoot>
    </table>,
  );
}

describe("StoreOrderDeliveryRow", () => {
  it("shows the delivery charge with its GST as one amount", () => {
    renderRow({ taxableValue: "49.00", taxAmount: "8.82", rate: "18.00" });
    const row = screen.getByTestId("store-order-delivery");
    expect(row).toHaveTextContent("Delivery charge");
    expect(row).toHaveTextContent(/49\.00 \+ GST .*8\.82 \(18%\)/);
    expect(row).toHaveTextContent(/57\.82/);
  });

  it("shows a charge with no GST without a GST note", () => {
    renderRow({ taxableValue: "30.00", taxAmount: "0.00", rate: "0.00" });
    expect(screen.getByTestId("store-order-delivery")).not.toHaveTextContent("GST");
    expect(screen.getByTestId("store-order-delivery")).toHaveTextContent(/30\.00/);
  });

  it("renders nothing for an order without delivery", () => {
    renderRow({ taxableValue: "0.00", taxAmount: "0.00", rate: "0.00" });
    expect(screen.queryByTestId("store-order-delivery")).toBeNull();
    renderRow(undefined);
    expect(screen.queryByTestId("store-order-delivery")).toBeNull();
  });
});
