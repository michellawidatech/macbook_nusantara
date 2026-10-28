/**
 * Asking how to buy, or to buy online (owner, 2026-10-28): the bot answers
 * with the variant's listing link — and none of these is a commitment,
 * a keep or a payment.
 */
import { describe, expect, it } from "vitest";
import { asksBuyOnline } from "../src/policy.js";

describe("asksBuyOnline", () => {
  it.each([
    "cara belinya gimana kak?",
    "bisa checkout di shopee?",
    "ada link shopee nya kak?",
    "ada link tokpednya?",
    "beli online bisa?",
    "aku order dari luar kota bisa?",
    "can I buy it online?",
  ])("reads %j as a buy-online question", (text) => {
    expect(asksBuyOnline(text)).toBe(true);
  });

  it.each([
    "mau keep unit ini dong kak",
    "saya ambil yang ini",
    "cara bayarnya?",
    "mau beli macbook buat kuliah",
    "ada air m2?",
  ])("leaves %j alone", (text) => {
    expect(asksBuyOnline(text)).toBe(false);
  });
});
