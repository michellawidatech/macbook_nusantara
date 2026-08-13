/**
 * Wall-clock context for the conversational agent — pure, no I/O.
 *
 * The model has no idea what day it is, so "besok" / "sabtu" used to reach
 * `create_reservation` as free text and get stored verbatim. Two fixes live here:
 *
 *  - {@link dateContext} injects "today" (and the next occurrence of every
 *    weekday) into the system prompt, so the model can resolve relative dates
 *    itself and send a proper YYYY-MM-DD.
 *  - {@link resolveDate} is the deterministic safety net on the write path: if a
 *    relative word slips through anyway, we turn it into a real date instead of
 *    persisting "besok" as the reservation date.
 *  - {@link staffWindow} answers "is a human around right now?" from the store's
 *    opening hours — the only thing we actually know about when staff reply.
 *
 * Everything is anchored to the store's timezone (WIB) — the server may run
 * anywhere, but "hari ini" always means today in Jakarta.
 */

import { STORE } from "@nusantara/domain";

/** The store's timezone. All customer-facing dates are resolved in it. */
export const STORE_TZ = "Asia/Jakarta";

/** An ISO date (YYYY-MM-DD), the shape the reservation row and tools expect. */
type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Indonesian weekday names, indexed by `Date#getUTCDay()` (0 = Sunday). */
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

/** Read a date/time field of `now` as seen in {@link STORE_TZ}. */
function partsInStoreTz(now: Date): { date: IsoDate; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    // en-CA renders midnight as "24" in some runtimes; normalize it to "00".
    time: `${p.hour === "24" ? "00" : p.hour}.${p.minute}`,
  };
}

/** Today's date in the store's timezone, as YYYY-MM-DD. */
export function today(now: Date = new Date()): IsoDate {
  return partsInStoreTz(now).date;
}

/**
 * Shift an ISO date by whole days. Parsed as UTC midnight so the arithmetic is
 * DST-free and independent of the server's local zone.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day-of-week index (0 = Sunday) of an ISO date. */
const dayOfWeek = (date: IsoDate): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "Selasa, 28 Juli 2026" for an ISO date. */
function longLabel(date: IsoDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The system-prompt block that tells the agent what "now" is. Includes the next
 * occurrence of every weekday so the model never has to do date arithmetic —
 * "sabtu" is a lookup, not a calculation.
 */
export function dateContext(now: Date = new Date()): string {
  const { date, time } = partsInStoreTz(now);
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(date, i + 1);
    return `${DAY_NAMES[dayOfWeek(d)]} = ${d}`;
  }).join(", ");
  return [
    `Waktu sekarang (WIB): ${longLabel(date)}, pukul ${time}.`,
    `Hari ini = ${date}. Besok = ${addDays(date, 1)}. Lusa = ${addDays(date, 2)}.`,
    `Hari berikutnya: ${upcoming}.`,
    `Kalau pelanggan menyebut waktu relatif ("hari ini", "besok", "lusa", "sabtu",` +
      ` "minggu depan"), hitung tanggalnya dari acuan di atas dan kirim ke tool` +
      ` dalam format YYYY-MM-DD. JANGAN mengirim kata relatifnya apa adanya, dan` +
      ` jangan menyebut tahun/tanggal lain di luar acuan ini.`,
  ].join("\n");
}

// ---------- Staff availability ----------

/** Whether a human is on duty now, and when the next shift starts. */
export interface StaffWindow {
  /** True while the store is open (STORE.openDays/openHour/closeHour, in WIB). */
  open: boolean;
  /** When staff are next around ("besok pukul 10.00"); `null` while open. */
  opensText: string | null;
}

/**
 * Are staff around to pick up a handoff? The bot must never tell a customer a
 * human "will reply shortly" at 2am — opening hours are the only fact we hold
 * about when a person is there, so the answer comes from them and nothing else.
 */
export function staffWindow(now: Date = new Date()): StaffWindow {
  const { date, time } = partsInStoreTz(now);
  const [h, m] = time.split(".").map(Number) as [number, number];
  const minutes = h * 60 + m;
  const openDays = new Set(STORE.openDays);
  const opensToday = openDays.has(dayOfWeek(date));

  if (opensToday && minutes >= STORE.openHour * 60 && minutes < STORE.closeHour * 60)
    return { open: true, opensText: null };

  const at = `pukul ${String(STORE.openHour).padStart(2, "0")}.00`;
  // Before opening on a working day, staff are back later the same day.
  if (opensToday && minutes < STORE.openHour * 60)
    return { open: false, opensText: `hari ini ${at}` };

  for (let i = 1; i <= 7; i++) {
    const next = addDays(date, i);
    if (!openDays.has(dayOfWeek(next))) continue;
    return { open: false, opensText: `${i === 1 ? "besok" : DAY_NAMES[dayOfWeek(next)]} ${at}` };
  }
  return { open: false, opensText: null }; // no open days configured — say nothing
}

/** Relative phrases → day offset from today. Longest key wins (see resolveDate). */
const OFFSETS: Record<string, number> = {
  "hari ini": 0,
  "hr ini": 0,
  "today": 0,
  "nanti": 0,
  "besok": 1,
  "bsk": 1,
  "esok": 1,
  "tomorrow": 1,
  "lusa": 2,
  "besok lusa": 2,
  "minggu depan": 7,
  "next week": 7,
};

/** Weekday word → day-of-week index. */
const WEEKDAYS: Record<string, number> = {
  minggu: 0, ahad: 0, sunday: 0,
  senin: 1, monday: 1,
  selasa: 2, tuesday: 2,
  rabu: 3, wednesday: 3,
  kamis: 4, thursday: 4,
  jumat: 5, "jum'at": 5, friday: 5,
  sabtu: 6, saturday: 6,
};

/**
 * Turn whatever the model (or a customer) wrote into a real YYYY-MM-DD, or
 * `null` when it is not a date we recognize. Already-ISO input passes through.
 * A bare weekday resolves to its NEXT occurrence (1–7 days ahead), never today —
 * someone who means today says "hari ini".
 */
export function resolveDate(raw: string | undefined, now: Date = new Date()): IsoDate | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;
  if (ISO_RE.test(text)) return Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? null : text;

  const base = today(now);

  // "minggu depan" must beat both "minggu" (weekday) and a shorter offset key,
  // so match the longest phrase present.
  const phrase = Object.keys(OFFSETS)
    .filter((k) => text.includes(k))
    .sort((a, b) => b.length - a.length)[0];

  const weekday = Object.keys(WEEKDAYS).find((k) => new RegExp(`\\b${k}\\b`).test(text));
  // "minggu depan" is next week, not Sunday.
  if (weekday && !(phrase && phrase.length > weekday.length && phrase.includes(weekday))) {
    const target = WEEKDAYS[weekday]!;
    const delta = (target - dayOfWeek(base) + 7) % 7 || 7;
    return addDays(base, delta);
  }
  if (phrase !== undefined) return addDays(base, OFFSETS[phrase]!);
  return null;
}

/**
 * The customer's first name from their WhatsApp profile name, for greeting and
 * as the default reservation name. Profile names are free text ("Budi | Jakarta",
 * "🌸 Sari Dewi"), so strip decoration, cut at the first separator, and keep the
 * leading word. Returns `null` when nothing name-like survives.
 */
export function firstName(profileName: string | null | undefined): string | null {
  if (!profileName) return null;
  const cleaned = profileName
    .replace(/[\p{Extended_Pictographic}]/gu, " ")
    .split(/[|,·\-–—/(]/)[0]!
    .trim();
  const word = cleaned.split(/\s+/).find((w) => /\p{L}/u.test(w));
  return word ? word.slice(0, 40) : null;
}
