import { describe, expect, it } from "vitest";
import {
  approvalMessage,
  chatRupiah,
  compareRequests,
  rejectionMessage,
  REQUEST_TTL_MS,
  requestIsOpen,
  requestStatus,
  requestWaiting,
  type RequestFacts,
} from "../src/reservationRequest.js";

const now = new Date("2026-10-27T05:00:00Z");
const base: RequestFacts = {
  createdAt: "2026-10-27T01:00:00Z",
  expiresAt: new Date(
    new Date("2026-10-27T01:00:00Z").getTime() + REQUEST_TTL_MS,
  ).toISOString(),
  unitCount: 1,
};

describe("requestStatus", () => {
  it("is pending until somebody answers or it lapses", () => {
    expect(requestStatus(base, now)).toBe("PENDING");
    expect(requestIsOpen(base, now)).toBe(true);
  });
  it("is approved once it names a reservation or was confirmed", () => {
    expect(requestStatus({ ...base, reservationId: "r1" }, now)).toBe(
      "APPROVED",
    );
    expect(
      requestStatus({ ...base, confirmedAt: "2026-10-27T02:00:00Z" }, now),
    ).toBe("APPROVED");
  });
  it("tells a rejection from a request the customer replaced", () => {
    const cancelled = { ...base, cancelledAt: "2026-10-27T02:00:00Z" };
    expect(requestStatus(cancelled, now)).toBe("REJECTED");
    expect(requestStatus({ ...cancelled, replaced: true }, now)).toBe(
      "REPLACED",
    );
    expect(requestIsOpen(cancelled, now)).toBe(false);
  });
  it("lapses at expiresAt", () => {
    expect(
      requestStatus(base, new Date(new Date(base.expiresAt).getTime())),
    ).toBe("EXPIRED");
  });
});

describe("requestWaiting", () => {
  it("reads a DP proof first, then whether a unit is wanted", () => {
    expect(requestWaiting({ ...base, dpProofAt: "2026-10-27T03:00:00Z" })).toBe(
      "DP_PROOF",
    );
    expect(requestWaiting(base)).toBe("WAITING_DP");
    expect(requestWaiting({ ...base, unitCount: 0 })).toBe("VISIT_ONLY");
  });
});

describe("compareRequests", () => {
  it("puts the oldest pending first and the lapsed last", () => {
    const older = base;
    const newer = { ...base, createdAt: "2026-10-27T02:00:00Z" };
    const done1 = { ...base, reservationId: "a" };
    const done2 = {
      ...base,
      createdAt: "2026-10-27T03:00:00Z",
      cancelledAt: "2026-10-27T04:00:00Z",
    };
    const replaced = { ...done2, replaced: true };
    const lapsed = { ...base, expiresAt: "2026-10-27T04:00:00Z" };
    const sorted = [lapsed, replaced, done1, newer, done2, older].sort((a, b) =>
      compareRequests(a, b, now),
    );
    expect(sorted).toEqual([older, newer, done2, done1, replaced, lapsed]);
  });
});

describe("what the customer is told", () => {
  const when = new Date("2026-10-28T07:00:00Z"); // 14.00 in Jakarta
  it("names the unit and the time, and the DP when one came in", () => {
    expect(
      approvalMessage({ unit: "MacBook Air M2", when, name: "Budi" }),
    ).toBe(
      "Okeyy kak noted, kak Budi nanti akan kita siapkan MacBook Air M2 nya yaa untuk 28 Oktober 2026 jam 14.00.",
    );
  });
  it("leaves the name out cleanly when there is none", () => {
    for (const name of [null, undefined, "  "])
      expect(approvalMessage({ unit: "MacBook Air M2", when, name })).toBe(
        "Okeyy kak noted, nanti akan kita siapkan MacBook Air M2 nya yaa untuk 28 Oktober 2026 jam 14.00.",
      );
  });
  it("waits for a visit when no unit is to be kept", () => {
    expect(approvalMessage({ unit: null, when, name: "Budi" })).toBe(
      "Okeyy kak noted, kak Budi nanti kita tunggu kedatangannya yaa di 28 Oktober 2026 jam 14.00.",
    );
  });
  it("says where the shop is when the chat does not have it yet", () => {
    const text = approvalMessage({
      unit: "MacBook Air M2",
      when,
      place: {
        address: "Jl. Mangga Dua 12",
        hours: "setiap hari 10.00–20.00 WIB",
      },
    });
    expect(text).toBe(
      "Okeyy kak noted, nanti akan kita siapkan MacBook Air M2 nya yaa untuk 28 Oktober 2026 jam 14.00. Toko kita ada di Jl. Mangga Dua 12, buka setiap hari 10.00–20.00 WIB.",
    );
    expect(text).not.toMatch(/ {2}/);
    expect(
      approvalMessage({
        unit: null,
        when,
        place: { address: "Jl. Mangga Dua 12", hours: null },
      }),
    ).toMatch(/Toko kita ada di Jl\. Mangga Dua 12\.$/);
  });
  it("says the DP in millions past a million", () => {
    expect(chatRupiah(1_500_000)).toBe("Rp1,5jt");
    expect(chatRupiah(500_000)).toBe("Rp500rb");
  });
  it("carries the reason on a rejection, or nothing", () => {
    expect(rejectionMessage(" Unitnya sudah terjual. ")).toBe(
      "Maaf kak, untuk reservasinya belum bisa kami proses ya 🙏 Unitnya sudah terjual.",
    );
    expect(rejectionMessage("  ")).toBe(
      "Maaf kak, untuk reservasinya belum bisa kami proses ya 🙏",
    );
  });
});
