import { describe, it, expect } from "vitest";
import {
  promisesHandoff,
  handoffTiming,
  handoffLine,
  handoffAck,
  ambiguousHandoff,
  asksClarification,
  AMBIGUOUS,
} from "./handoff.js";

// Store hours are every day, 10.00–20.00 WIB (STORE.openDays/openHour/closeHour).
const OPEN = new Date("2026-07-28T05:00:00Z"); // Tue 12.00 WIB
const AFTER_HOURS = new Date("2026-07-28T16:00:00Z"); // Tue 23.00 WIB
const BEFORE_OPEN = new Date("2026-07-28T01:00:00Z"); // Tue 08.00 WIB
const SAT_NIGHT = new Date("2026-08-01T16:00:00Z"); // Sat 23.00 WIB
const SUNDAY = new Date("2026-08-02T05:00:00Z"); // Sun 12.00 WIB — the store is open

describe("promisesHandoff", () => {
  it("catches the ways the agent says a human is taking over", () => {
    expect(promisesHandoff("Baik kak, aku sambungkan ke tim ya 🙏")).toBe(true);
    expect(promisesHandoff("Aku teruskan ke admin dulu ya kak")).toBe(true);
    expect(promisesHandoff("Biar tim kami yang cek ya kak")).toBe(true);
    expect(promisesHandoff("Nanti staf kami hubungi kakak ya")).toBe(true);
    expect(promisesHandoff("Ini ditangani langsung sama tim kami kak")).toBe(true);
    expect(promisesHandoff("Aku tanyakan ke owner dulu soal harganya")).toBe(true);
  });

  it("does not fire on an ordinary answer", () => {
    expect(promisesHandoff("Stok Air M2 ada 2 unit kak, harganya Rp 15 jt 😊")).toBe(false);
    expect(promisesHandoff("Toko buka Senin–Sabtu, 10.00–20.00 WIB kak")).toBe(false);
    expect(promisesHandoff("Aku cek stoknya dulu ya kak")).toBe(false);
    expect(promisesHandoff("Reservasi kakak sudah masuk, kodenya RSV-ABC")).toBe(false);
  });
});

describe("handoffTiming", () => {
  it("promises no response time while the store is open", () => {
    const out = handoffTiming(OPEN);
    expect(out).toBe("Mohon ditunggu sebentar ya kak.");
    // Never an invented SLA.
    expect(out).not.toMatch(/menit|segera|jam ini/i);
  });

  it("says when staff are actually back instead of 'segera'", () => {
    expect(handoffTiming(AFTER_HOURS)).toContain("besok pukul 10.00");
    expect(handoffTiming(BEFORE_OPEN)).toContain("hari ini pukul 10.00");
    // The store opens Senin s/d Minggu, so Saturday night is just "besok".
    expect(handoffTiming(SAT_NIGHT)).toContain("besok pukul 10.00");
    expect(handoffTiming(SUNDAY)).toBe("Mohon ditunggu sebentar ya kak."); // Sunday is a working day
    expect(handoffTiming(AFTER_HOURS)).toContain("di luar jam operasional");
  });
});

describe("handoffLine / handoffAck", () => {
  it("states the handoff plainly, with the store's hours as the only timing claim", () => {
    expect(handoffLine(OPEN)).toBe("Aku teruskan ke tim kami ya kak. Mohon ditunggu sebentar ya kak.");
    // The line is appended to an already emoji-capped reply, so it adds none.
    expect(handoffLine(AFTER_HOURS)).not.toMatch(/\p{Extended_Pictographic}/u);

    const ack = handoffAck(AFTER_HOURS);
    expect(ack).toContain("Macbook Nusantara"); // the full store name, never just "Nusantara"
    expect(ack).toContain("besok pukul 10.00");
    expect(ack).not.toContain("segera");
  });

  it("is itself recognized as a handoff promise (the pipeline must not double up)", () => {
    expect(promisesHandoff(handoffLine(OPEN))).toBe(true);
    expect(promisesHandoff(handoffAck(OPEN))).toBe(true);
  });
});

describe("ambiguousHandoff", () => {
  it("hands over without inventing a response time", () => {
    expect(ambiguousHandoff(OPEN)).toContain("belum nangkep maksudnya");
    expect(ambiguousHandoff(OPEN)).not.toMatch(/segera|menit/);
    expect(ambiguousHandoff(AFTER_HOURS)).toContain("besok pukul 10.00");
  });

  it("is recognized as a handoff promise, so the pipeline does not append another", () => {
    expect(promisesHandoff(ambiguousHandoff(OPEN))).toBe(true);
  });

  it("names the same reason the persona tells the model to use", () => {
    expect(AMBIGUOUS).toBe("ambiguous");
  });
});

describe("asksClarification", () => {
  it("catches a clarifying question the model asked without calling the tool", () => {
    // All three observed on live traffic during e2e.
    expect(asksClarification("Maksudnya yang ukuran 13 inchi atau 15 inchi ya kak?")).toBe(true);
    expect(asksClarification("Kak, maksudnya unit apa yang kamu tanya, biar aku bantu cek harganya?")).toBe(true);
    expect(asksClarification("Kak maaf, aku kurang paham yang satunya itu unit apa ya?")).toBe(true);
    expect(asksClarification("Aku masih bingung yang mana ya kak?")).toBe(true);
  });

  it("leaves a normal sales question alone", () => {
    // The persona explicitly tells the agent to ask these — counting them would
    // escalate healthy conversations.
    expect(asksClarification("kakak lebih sreg yang mana?")).toBe(false);
    expect(asksClarification("Mau dipakai buat apa nihh?")).toBe(false);
    expect(asksClarification("13 inchi atau 15 inchi lebih suka yang mana buat desain grafis?")).toBe(false);
    expect(asksClarification("Budget kakak sekitar berapa ya?")).toBe(false);
  });

  it("needs an actual question, not just the words", () => {
    expect(asksClarification("Maaf kak, aku kurang paham.")).toBe(false);
  });
});
