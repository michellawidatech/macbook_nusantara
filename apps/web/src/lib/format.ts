/** Read-only money/date formatting — must agree with MoneyInput's display. */
export const fmtRp = (n: number | null | undefined): string =>
  n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export const fmtDate = (v: string): string =>
  new Date(v).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
