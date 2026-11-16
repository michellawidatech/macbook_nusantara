import { describe, expect, it } from "vitest";
import { casualPunctuation } from "../src/casualText.js";

describe("casualPunctuation (owner, 2026-11-16: full stops read as rude)", () => {
  it("drops the full stop a line ends on", () => {
    expect(
      casualPunctuation("Untuk garansinya nanti tim kami konfirmasi ya kak."),
    ).toBe("Untuk garansinya nanti tim kami konfirmasi ya kak");
    expect(casualPunctuation("Halo kak.\nAda yang bisa aku bantu?")).toBe(
      "Halo kak\nAda yang bisa aku bantu?",
    );
  });

  it("puts a sentence that ends mid-line on a line of its own", () => {
    expect(
      casualPunctuation(
        "Bentar ya kak, aku cek dulu. Toko lagi tutup, nanti aku kabari pas buka jam 10.00 ya.",
      ),
    ).toBe(
      "Bentar ya kak, aku cek dulu\nToko lagi tutup, nanti aku kabari pas buka jam 10.00 ya",
    );
    expect(
      casualPunctuation("Siap kak. Mau aku cariin yang paling pas kak?"),
    ).toBe("Siap kak\nMau aku cariin yang paling pas kak?");
    // A number ending a sentence is still a sentence end.
    expect(casualPunctuation("Harganya 8.500.000. Gimana kak?")).toBe(
      "Harganya 8.500.000\nGimana kak?",
    );
  });

  it("keeps the dots that are not sentence ends", () => {
    expect(
      casualPunctuation("Air M1 8.500.000, buka jam 10.00 sampai 20.00"),
    ).toBe("Air M1 8.500.000, buka jam 10.00 sampai 20.00");
    expect(casualPunctuation("Rp 2,3jt ya kak, layar 13.3 inch")).toBe(
      "Rp 2,3jt ya kak, layar 13.3 inch",
    );
    expect(casualPunctuation("hmm... gimana ya..")).toBe("hmm... gimana ya..");
    expect(casualPunctuation("Alamat Jl. Sudirman No. 5, a.n. Budi")).toBe(
      "Alamat Jl. Sudirman No. 5, a.n. Budi",
    );
    expect(casualPunctuation("Dari A. Rahman ya kak")).toBe(
      "Dari A. Rahman ya kak",
    );
    expect(
      casualPunctuation("Linknya https://shopee.co.id/a.b. Bisa juga lewat WA"),
    ).toBe("Linknya https://shopee.co.id/a.b. Bisa juga lewat WA");
    expect(casualPunctuation('Yang ini ("Air"). Oke')).toBe(
      'Yang ini ("Air")\nOke',
    );
    // Lower case after it: not obviously a new sentence, left as it is.
    expect(casualPunctuation("datang aja. nanti aku bantu")).toBe(
      "datang aja. nanti aku bantu",
    );
    // A numbered list keeps its numbers.
    expect(casualPunctuation("1. Ini garansi gk ya.\n2. Ongkirnya brp?")).toBe(
      "1. Ini garansi gk ya\n2. Ongkirnya brp?",
    );
    expect(casualPunctuation("Gimana kakk? Kakak juga bisa lihat")).toBe(
      "Gimana kakk? Kakak juga bisa lihat",
    );
  });

  it("drops a dangling comma and tidies blank lines", () => {
    expect(casualPunctuation("atau smartphone aja udah cukup,")).toBe(
      "atau smartphone aja udah cukup",
    );
    expect(casualPunctuation("Satu.\n\n\n\nDua.")).toBe("Satu\n\nDua");
    expect(casualPunctuation("   ")).toBe("");
    expect(casualPunctuation(null)).toBe("");
    expect(casualPunctuation(undefined)).toBe("");
  });
});
