/**
 * The staff half of a chat summary (owner, 2026-10-27): what the customer
 * wants and what happens next — never the bot's memory notes under them.
 */
import { describe, expect, it } from "vitest";
import {
  SUMMARY_EXCERPT_CHARS,
  clipSummary,
  staffSummary,
} from "../src/chatSummary.js";

describe("staffSummary", () => {
  it("reads the two staff lines and leaves the memory notes out", () => {
    expect(
      staffSummary(
        [
          'Mau: Mau beli MacBook Pro 14" M1 Pro 16/512, mau reservasi',
          "Selanjutnya: Konfirmasi unit yang dipilih + jam datang",
          "",
          "Nama Rina, budget 20jt, buat edit video.",
        ].join("\n"),
      ),
    ).toEqual({
      wants: 'Mau beli MacBook Pro 14" M1 Pro 16/512, mau reservasi',
      next: "Konfirmasi unit yang dipilih + jam datang",
      excerpt: null,
    });
  });

  it("finds the lines wherever they are, in any case, first one winning", () => {
    expect(
      staffSummary(
        "selanjutnya : Tunggu balasan\n\nMAU: Air M2\nMau: yang lain",
      ),
    ).toEqual({ wants: "Air M2", next: "Tunggu balasan", excerpt: null });
  });

  it("reads one line without the other, and skips an empty one", () => {
    expect(staffSummary("Mau:\nMau: Air M1\nNama Budi")).toEqual({
      wants: "Air M1",
      next: null,
      excerpt: null,
    });
    expect(staffSummary("Selanjutnya: Kirim foto")).toEqual({
      wants: null,
      next: "Kirim foto",
      excerpt: null,
    });
  });

  it("shows an old-format note's opening, clipped with an ellipsis", () => {
    const old =
      "The customer wants a MacBook Pro 14 inch M1 Pro with 16GB RAM and 512GB storage. The shop quoted Rp 21.500.000. The shop is at Jl. Example 1, open 10.00 to 20.00, and a DP of Rp 500.000 holds a unit for seven days.";
    const s = staffSummary(old)!;
    expect(s.wants).toBeNull();
    expect(s.next).toBeNull();
    expect(s.excerpt!.length).toBeLessThanOrEqual(SUMMARY_EXCERPT_CHARS);
    expect(s.excerpt).toMatch(/^The customer wants a MacBook Pro.*…$/);
    expect(staffSummary("Mau Air M2, budget 15jt.")).toEqual({
      wants: null,
      next: null,
      excerpt: "Mau Air M2, budget 15jt.",
    });
  });

  it("is null for no summary", () => {
    expect(staffSummary(null)).toBeNull();
    expect(staffSummary(undefined)).toBeNull();
    expect(staffSummary("  \n ")).toBeNull();
  });
});

describe("clipSummary", () => {
  it("cuts mid-word when there is no space late enough", () => {
    expect(clipSummary("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`);
    expect(clipSummary("abc defghijklmnop", 10)).toBe("abc defgh…");
  });
});
