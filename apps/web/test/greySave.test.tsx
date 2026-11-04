/** A Save is grey until something changed (owner list 2026-11-03). */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentsModal } from "../src/components/PaymentsModal.js";

describe("grey Save", () => {
  it("is grey on the payments dialog until a payment changes", async () => {
    render(
      <AntdApp>
        <PaymentsModal
          open
          orderId="o-1"
          code="SI-1"
          total={1_000_000}
          payments={[
            {
              id: "p1",
              method: "TUNAI",
              amount: 1_000_000,
              state: "SETTLED",
              at: "2026-11-01T00:00:00.000Z",
            },
          ]}
          log={[]}
          onClose={() => undefined}
          onSave={() => undefined}
        />
      </AntdApp>,
    );
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });
});
