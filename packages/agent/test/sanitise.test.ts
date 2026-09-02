/**
 * The two pure text rules the agent's voice depends on.
 *
 * ## Why a sanitiser exists at all
 *
 * The persona says "never use bold, bullets, headings, or the characters
 * — ; ! ( )". A persona is a request, and a small model honours it most of the
 * time. Most of the time is not a guarantee, and the one reply in thirty that
 * arrives as a markdown bullet list is the one that makes the shop look like a
 * bot. `stripFormatting` is the enforcement: the rule holds because the text is
 * rewritten, not because the model was asked nicely.
 *
 * ## Why language detection is a function and not a prompt line
 *
 * The shop's customers write Indonesian, English, and a running mix of both
 * ("ada stock yang grade A ga?"). Telling the model "mirror the customer" works
 * better when the prompt also states which language it is looking at, and that
 * decision has to be inspectable when a reply comes back in the wrong one.
 *
 * Both are pure. No model call, no database, no clock.
 */

import { describe, expect, it } from "vitest";
import { detectLanguage, stripFormatting } from "../src/sanitise.js";

describe("stripFormatting", () => {
  it("replaces an em-dash with a comma rather than sending one the persona forbids", () => {
    expect(stripFormatting("Ready kak — harganya 15.500.000")).toBe(
      "Ready kak, harganya 15.500.000",
    );
  });

  it("strips an en-dash too, which is the character a model reaches for next", () => {
    expect(stripFormatting("stok ada – tinggal satu")).toBe(
      "stok ada, tinggal satu",
    );
  });

  it("drops the exclamation mark that makes a shop admin sound like an advert", () => {
    // Straight from the correction fixture: the agent wrote "Ready kak!", a
    // person wrote "Ready kakk,".
    expect(stripFormatting("Ready kak! stoknya ada")).toBe(
      "Ready kak. stoknya ada",
    );
  });

  it("turns a semicolon into a comma, since nobody types one on a phone", () => {
    expect(stripFormatting("ada dua unit; keduanya grade A")).toBe(
      "ada dua unit, keduanya grade A",
    );
  });

  it("keeps what is inside parentheses and throws the brackets away", () => {
    expect(stripFormatting("MacBook Air (M2) 256GB")).toBe(
      "MacBook Air M2 256GB",
    );
  });

  it("unwraps bold instead of sending asterisks to a customer", () => {
    expect(stripFormatting("harganya **15.500.000** nego tipis")).toBe(
      "harganya 15.500.000 nego tipis",
    );
  });

  it("flattens a bullet list into sentences, which is how a person would send it", () => {
    expect(stripFormatting("- MacBook Air M2\n- MacBook Pro 14")).toBe(
      "MacBook Air M2\nMacBook Pro 14",
    );
    expect(stripFormatting("• satu\n* dua")).toBe("satu\ndua");
  });

  it("strips a heading marker rather than shouting a title at the customer", () => {
    expect(stripFormatting("## Stok hari ini\nada tiga unit")).toBe(
      "Stok hari ini\nada tiga unit",
    );
  });

  it("collapses the double space a stripped character leaves behind", () => {
    // "kak — harganya" becomes "kak, harganya", not "kak ,  harganya".
    expect(stripFormatting("kak  —  harganya  15jt")).toBe(
      "kak, harganya 15jt",
    );
  });

  it("leaves ordinary Indonesian text exactly as it was", () => {
    const plain = "ada kak, MacBook Air M2 256GB grade A, harganya 15.500.000";
    expect(stripFormatting(plain)).toBe(plain);
  });

  it("leaves a question mark alone, because the bot has to be able to ask", () => {
    expect(stripFormatting("mau dipakai buat apa kak?")).toBe(
      "mau dipakai buat apa kak?",
    );
  });

  it("keeps one emoji and drops the rest, so warmth never becomes a sticker wall", () => {
    // The persona asks for at most one. This is what makes it true: a model
    // that got excited still cannot send "HALO KAK!!! 😊😊😊✨✨".
    expect(stripFormatting("halo kak 😊😊😊 ✨✨")).toBe("halo kak 😊");
    expect(stripFormatting("siap 👍 makasih 🙏")).toBe("siap 👍 makasih");
  });

  it("leaves a single emoji exactly where the model put it", () => {
    expect(stripFormatting("boleh kak 😊 budgetnya berapa?")).toBe(
      "boleh kak 😊 budgetnya berapa?",
    );
  });

  it("turns an excited greeting into something a shop admin would type", () => {
    // The bad example from the brief, run through the real sanitiser.
    expect(stripFormatting("HALO KAK!!! 😊😊😊✨✨ Ada yang bisa saya bantu? 😍")).toBe(
      "HALO KAK. 😊 Ada yang bisa saya bantu?",
    );
  });

  it("drops the full stop a line ends on, which nobody types on WhatsApp", () => {
    expect(stripFormatting("ready kak, stoknya masih ada.")).toBe(
      "ready kak, stoknya masih ada",
    );
    expect(stripFormatting("baik kak\nnanti aku kabarin lagi ya.")).toBe(
      "baik kak\nnanti aku kabarin lagi ya",
    );
  });

  it("drops a stranded comma too, which is what the model reaches for instead", () => {
    // Told not to end on a full stop, the model ends on a comma and leaves the
    // line dangling: "atau justru smartphone aja udah cukup,".
    expect(stripFormatting("atau justru smartphone aja udah cukup,")).toBe(
      "atau justru smartphone aja udah cukup",
    );
  });

  it("keeps the separators inside a price and loses only the sentence's stop", () => {
    // The one case where getting this wrong would misquote money.
    expect(stripFormatting("harganya 15.770.000.")).toBe("harganya 15.770.000");
    expect(stripFormatting("harganya 15.770.000")).toBe("harganya 15.770.000");
  });

  it("leaves an ellipsis alone, since trailing off is how people do type", () => {
    expect(stripFormatting("hmm gimana ya kak...")).toBe("hmm gimana ya kak...");
  });

  it("leaves a question mark alone, so a question still looks like one", () => {
    expect(stripFormatting("kakak enaknya mampir kapan?")).toBe(
      "kakak enaknya mampir kapan?",
    );
  });

  it("turns a final exclamation mark into nothing rather than a full stop", () => {
    // "!" already became "." before this rule existed. Now it goes entirely,
    // which is what a person typing would have done.
    expect(stripFormatting("siap kak!")).toBe("siap kak");
  });

  it("returns an empty string for empty input rather than throwing", () => {
    expect(stripFormatting("")).toBe("");
    expect(stripFormatting("   ")).toBe("");
  });
});

describe("detectLanguage", () => {
  it("reads casual Indonesian as Indonesian", () => {
    expect(detectLanguage("ada macbook air m2 ga kak?")).toBe("id");
    expect(detectLanguage("saya mau yang warna silver aja")).toBe("id");
  });

  it("reads plain English as English", () => {
    expect(detectLanguage("do you still have the m2 air in stock?")).toBe("en");
    expect(detectLanguage("what is the price for the 512gb one")).toBe("en");
  });

  it("reads a code-switched sentence as mixed, not as one or the other", () => {
    // This is how most of the shop's customers actually write.
    expect(detectLanguage("sorry kak, is it still available? mau yang fullset")).toBe(
      "mix",
    );
  });

  it("treats a bare product name as neutral, so 'MacBook Air M2' is not English", () => {
    // Apple names are English everywhere on earth. Reading them as a language
    // signal would flip the whole thread to English on one message.
    expect(detectLanguage("MacBook Air M2 256GB")).toBe("id");
    expect(detectLanguage("iPhone 13 Pro Max")).toBe("id");
  });

  it("defaults to Indonesian when there is nothing to go on", () => {
    // The shop is in Jakarta. With no signal, Indonesian is the safer guess.
    expect(detectLanguage("")).toBe("id");
    expect(detectLanguage("15500000")).toBe("id");
    expect(detectLanguage("ok")).toBe("id");
  });
});
