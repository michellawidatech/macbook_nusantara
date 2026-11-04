/** The unit inside a battery box reads grey (owner list 2026-11-03). */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BatteryFields } from "../src/components/BatteryFields.js";

describe("BatteryFields suffix", () => {
  it("draws cc and mAh in the secondary text colour", () => {
    render(
      <BatteryFields
        fallback="CYCLES"
        value={{}}
        onChange={() => undefined}
        idPrefix="t"
      />,
    );
    for (const s of ["cc", "mAh"])
      expect(screen.getByText(s).style.color).not.toBe("");
  });
});
