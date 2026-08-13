import { describe, it, expect } from "vitest";
import { today, addDays, dateContext, resolveDate, firstName, staffWindow } from "./clock.js";

// 2026-07-28 is a Tuesday. 17:00Z = 00:00 next day in WIB (UTC+7).
const TUE_NOON_WIB = new Date("2026-07-28T05:00:00Z");

describe("today", () => {
  it("reads the date in Jakarta, not UTC", () => {
    expect(today(TUE_NOON_WIB)).toBe("2026-07-28");
    // 18:30 UTC is already the next day in WIB.
    expect(today(new Date("2026-07-28T18:30:00Z"))).toBe("2026-07-29");
    // ...and just before WIB midnight it is still the same day.
    expect(today(new Date("2026-07-28T16:59:00Z"))).toBe("2026-07-28");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-07-28", 1)).toBe("2026-07-29");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dateContext", () => {
  it("states today, tomorrow, and the next occurrence of every weekday", () => {
    const ctx = dateContext(TUE_NOON_WIB);
    expect(ctx).toContain("Selasa, 28 Juli 2026");
    expect(ctx).toContain("Hari ini = 2026-07-28");
    expect(ctx).toContain("Besok = 2026-07-29");
    expect(ctx).toContain("Lusa = 2026-07-30");
    expect(ctx).toContain("Sabtu = 2026-08-01");
    expect(ctx).toContain("Selasa = 2026-08-04"); // next Tuesday, not today
    expect(ctx).toContain("YYYY-MM-DD");
  });
});

describe("resolveDate", () => {
  const on = (raw: string | undefined) => resolveDate(raw, TUE_NOON_WIB);

  it("passes an ISO date through", () => {
    expect(on("2026-09-03")).toBe("2026-09-03");
  });

  it("resolves relative words", () => {
    expect(on("hari ini")).toBe("2026-07-28");
    expect(on("Besok")).toBe("2026-07-29");
    expect(on("besok sore")).toBe("2026-07-29");
    expect(on("lusa")).toBe("2026-07-30");
    expect(on("tomorrow")).toBe("2026-07-29");
  });

  it("resolves a weekday to its next occurrence, never today", () => {
    expect(on("sabtu")).toBe("2026-08-01");
    expect(on("hari senin")).toBe("2026-08-03");
    expect(on("selasa")).toBe("2026-08-04"); // today is Tuesday → next week
  });

  it("reads 'minggu depan' as next week, not Sunday", () => {
    expect(on("minggu depan")).toBe("2026-08-04");
    expect(on("minggu")).toBe("2026-08-02"); // the day Sunday
  });

  it("returns null for nothing date-like", () => {
    expect(on(undefined)).toBeNull();
    expect(on("  ")).toBeNull();
    expect(on("kapan aja kak")).toBeNull();
    expect(on("2026-13-45")).toBeNull();
  });
});

describe("staffWindow", () => {
  it("reads the store's own hours (every day, 10.00–20.00 WIB), in WIB", () => {
    expect(staffWindow(TUE_NOON_WIB)).toEqual({ open: true, opensText: null });
    // 03.00 WIB — the edge that used to get "akan segera dibalas".
    expect(staffWindow(new Date("2026-07-27T20:00:00Z"))).toEqual({
      open: false,
      opensText: "hari ini pukul 10.00",
    });
    // 20.00 WIB sharp is already closed.
    expect(staffWindow(new Date("2026-07-28T13:00:00Z")).open).toBe(false);
    // 09.59 WIB, one minute short of opening.
    expect(staffWindow(new Date("2026-07-28T02:59:00Z")).open).toBe(false);
    // 10.00 WIB sharp is open.
    expect(staffWindow(new Date("2026-07-28T03:00:00Z")).open).toBe(true);
  });

  it("counts the weekend, because the store opens Senin s/d Minggu", () => {
    // Sunday noon — open, so no "tim balas Senin" for a customer who is here now.
    expect(staffWindow(new Date("2026-08-02T05:00:00Z")).open).toBe(true);
    // Saturday 23.00 WIB → the next shift is simply tomorrow.
    expect(staffWindow(new Date("2026-08-01T16:00:00Z")).opensText).toBe("besok pukul 10.00");
  });
});

describe("firstName", () => {
  it("extracts a usable first name from a WhatsApp profile name", () => {
    expect(firstName("Budi Santoso")).toBe("Budi");
    expect(firstName("Sari | Jakarta")).toBe("Sari");
    expect(firstName("🌸 Dewi Lestari")).toBe("Dewi");
    expect(firstName("  andi  ")).toBe("andi");
  });

  it("returns null when there is no name", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName("🌸🌸")).toBeNull();
  });
});
