/**
 * The serial history shows EVERY photo of a unit (owner report 2026-11-07:
 * a unit with 13 drew 8 and "+5", squeezed into the third column of the
 * details grid).
 */
import { render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SerialHistory } from "../src/components/SerialHistory.js";
import { getDb, mutate } from "../src/mock/store.js";

describe("the serial history's photos", () => {
  it("draws all thirteen, with nothing behind a +N", async () => {
    const unit = getDb().units.find((u) => u.status === "TERSEDIA")!;
    await mutate((d) => {
      d.unitNotes.push({
        id: "note-thirteen",
        serial: unit.serial,
        tag: "QC",
        at: new Date().toISOString(),
        staff: "Test",
        body: "",
        photos: Array.from({ length: 13 }, (_, i) => ({
          id: `ph-thirteen-${i}`,
          url: "data:image/png;base64,AA==",
          sortOrder: i,
        })),
      });
    });
    render(
      <AntdApp>
        <MemoryRouter>
          <SerialHistory db={getDb()} serial={unit.serial} onBack={() => {}} />
        </MemoryRouter>
      </AntdApp>,
    );
    const shown = await screen.findAllByRole("img", {
      name: `Photo of ${unit.serial}`,
    });
    expect(shown.length).toBeGreaterThanOrEqual(13);
    expect(screen.queryByLabelText(/\d+ more/)).toBeNull();
  });
});
