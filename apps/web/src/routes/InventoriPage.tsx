/**
 * Inventori — read-only. 03-pages-and-features.md and 02 §8.
 *
 * Written **plainly and on purpose**. S9's constraint: "write this screen
 * without extracting shared components. The kit is Increment 1 and it will be
 * extracted from what this screen actually needs. Do not generalise early."
 *
 * So there is no <DataTable> here, no <FilterChip>, no <Pagination>. When the
 * kit is extracted, it will be extracted from a screen whose requirements are
 * known rather than imagined — which is exactly how the previous build ended up
 * with single-select filters and three-line row wrapping.
 *
 * Everything that describes the view lives in the URL (01 §5), so a staff
 * member can paste "the twelve units that failed opname" to a colleague.
 */

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { formatNumber } from "@nusantara/domain";
import { api } from "../lib/api.js";
import styles from "./InventoriPage.module.css";

interface Column {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly unit: string | null;
  readonly categoryId: string;
}

interface Row {
  readonly id: string;
  readonly serial: string;
  readonly status: string;
  readonly grade: string | null;
  readonly skuCode: string;
  readonly skuName: string;
  readonly kategori: string;
  readonly lokasi: string;
  /** Money arrives as a string (01 §4) and is parsed back to BigInt here. */
  readonly landed: string;
  readonly intakeAt: string;
  readonly attrs: Record<string, string>;
}

interface InventoriResponse {
  readonly rows: readonly Row[];
  readonly columns: readonly Column[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly totalUnfiltered: number;
}

interface Option {
  readonly id: string;
  readonly name: string;
  readonly count?: number;
}

interface FiltersResponse {
  readonly lokasi: readonly Option[];
  readonly kategori: readonly Option[];
  readonly status: readonly Option[];
  readonly grade: readonly Option[];
}

/** The four multi-select facets, in the order they appear in the toolbar. */
const FACETS = [
  { param: "lokasi", label: "Lokasi" },
  { param: "kategori", label: "Kategori" },
  { param: "status", label: "Status" },
  { param: "grade", label: "Grade" },
] as const;

type FacetParam = (typeof FACETS)[number]["param"];

export function InventoriPage() {
  const [params, setParams] = useSearchParams();

  const selected = useMemo(() => {
    const out = {} as Record<FacetParam, string[]>;
    for (const { param } of FACETS) {
      const raw = params.get(param);
      out[param] = raw === null || raw === "" ? [] : raw.split(",");
    }
    return out;
  }, [params]);

  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "serial";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page") ?? "1");

  // 02 §1: list filtering is debounced 250 ms server-side. The input itself is
  // local state so a keystroke never waits on a round trip (< 50 ms budget).
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => {
    if (draftQ === q) return;
    const id = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (draftQ === "") next.delete("q");
        else next.set("q", draftQ);
        next.delete("page");
        return next;
      });
    }, 250);
    return () => clearTimeout(id);
  }, [draftQ, q, setParams]);

  const filters = useQuery({
    queryKey: ["katalog", "inventori", "filters"],
    queryFn: () => api<FiltersResponse>("/api/katalog/inventori/filters"),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ["katalog", "inventori", params.toString()],
    queryFn: () =>
      api<InventoriResponse>(`/api/katalog/inventori?${params.toString()}`),
    // 02 §12: show stale data while refetching, dimmed. Blanking a table the
    // user is reading is strictly worse than 30-second-old numbers.
    placeholderData: keepPreviousData,
  });

  const update = (mutate: (next: URLSearchParams) => void) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      mutate(next);
      return next;
    });
  };

  const toggle = (param: FacetParam, id: string) => {
    update((next) => {
      const current = selected[param];
      const after = current.includes(id)
        ? current.filter((v) => v !== id)
        : [...current, id];
      if (after.length === 0) next.delete(param);
      else next.set(param, after.join(","));
      next.delete("page"); // a new filter starts at page 1
    });
  };

  const sortBy = (column: string) => {
    update((next) => {
      // Both are always written, even when the column is already the active
      // one: a URL that carries `dir` but not `sort` does not reproduce the
      // view it was copied from.
      next.set("sort", column);
      next.set("dir", sort === column && dir === "asc" ? "desc" : "asc");
      next.delete("page");
    });
  };

  const resetAll = () => setParams(new URLSearchParams());

  const data = query.data;
  const columns = data?.columns ?? [];
  const activeChips = FACETS.flatMap(({ param, label }) =>
    selected[param].map((id) => ({
      param,
      id,
      label,
      name: filters.data?.[param].find((o) => o.id === id)?.name ?? id,
    })),
  );

  const hasFilters = activeChips.length > 0 || q !== "";
  const lastPage =
    data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.perPage));

  const sortIndicator = (column: string) =>
    sort === column ? (dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <section className={styles.page} aria-labelledby="inventori-title">
      <header className={styles.head}>
        <h1 id="inventori-title" className={styles.title}>
          Inventori
        </h1>
        <p className={styles.count} role="status" aria-live="polite">
          {data === undefined
            ? "Memuat…"
            : `${data.total.toLocaleString("id-ID")} unit`}
          {query.isFetching && data !== undefined ? " · menyegarkan…" : ""}
        </p>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span className={styles.srOnly}>Cari serial atau SKU</span>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Cari serial atau SKU…"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </label>

        {FACETS.map(({ param, label }) => (
          <details key={param} className={styles.facet}>
            <summary className={styles.facetSummary}>
              {label}
              {selected[param].length > 0 ? ` (${selected[param].length})` : ""}
            </summary>
            <fieldset className={styles.facetList}>
              <legend className={styles.srOnly}>{label}</legend>
              {(filters.data?.[param] ?? []).map((option) => (
                <label key={option.id} className={styles.facetOption}>
                  <input
                    type="checkbox"
                    checked={selected[param].includes(option.id)}
                    onChange={() => toggle(param, option.id)}
                  />
                  <span>{option.name}</span>
                  {option.count === undefined ? null : (
                    // Spaced and named: concatenated straight onto the label
                    // the accessible name reads "A12" rather than "A, 12 unit".
                    <span
                      className={styles.facetCount}
                    >{` ${option.count} unit`}</span>
                  )}
                </label>
              ))}
            </fieldset>
          </details>
        ))}
      </div>

      {/* 02 §8: active filters are removable chips, with a Reset that clears
          all, so the user can see at a glance why a row count is low. */}
      {hasFilters ? (
        <div className={styles.chips} aria-label="Filter aktif">
          {q === "" ? null : (
            <button
              type="button"
              className={styles.chip}
              onClick={() => update((n) => n.delete("q"))}
            >
              Cari: {q} <span aria-hidden="true">×</span>
              <span className={styles.srOnly}>Hapus filter pencarian</span>
            </button>
          )}
          {activeChips.map((chip) => (
            <button
              key={`${chip.param}:${chip.id}`}
              type="button"
              className={styles.chip}
              onClick={() => toggle(chip.param, chip.id)}
            >
              {chip.label}: {chip.name} <span aria-hidden="true">×</span>
              <span className={styles.srOnly}>Hapus filter {chip.name}</span>
            </button>
          ))}
          <button type="button" className={styles.reset} onClick={resetAll}>
            Reset
          </button>
        </div>
      ) : null}

      {query.isError ? (
        <div className={styles.state} role="alert">
          <p>Gagal memuat inventori.</p>
          <button
            type="button"
            className={styles.reset}
            onClick={() => void query.refetch()}
          >
            Coba lagi
          </button>
        </div>
      ) : null}

      <div
        className={`${styles.tableWrap} ${query.isFetching ? styles.stale : ""}`}
      >
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            Daftar unit. Kolom atribut berasal dari CategoryAttribute.
          </caption>
          <thead>
            <tr>
              {[
                ["serial", "Serial"],
                ["sku", "SKU"],
                ["status", "Status"],
                ["lokasi", "Lokasi"],
              ].map(([key, label]) => (
                <th key={key} scope="col">
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => sortBy(key!)}
                  >
                    {label}
                    {sortIndicator(key!)}
                  </button>
                </th>
              ))}
              <th scope="col">Grade</th>
              {/* Not hardcoded: these come from CategoryAttribute. */}
              {columns.map((c) => (
                <th key={c.id} scope="col">
                  {c.label}
                  {c.unit === null ? "" : ` (${c.unit})`}
                </th>
              ))}
              <th scope="col" className={styles.numeric}>
                <button
                  type="button"
                  className={styles.sortButton}
                  onClick={() => sortBy("landed")}
                >
                  Modal (Rp){sortIndicator("landed")}
                </button>
              </th>
              <th scope="col">
                <button
                  type="button"
                  className={styles.sortButton}
                  onClick={() => sortBy("intakeAt")}
                >
                  Masuk{sortIndicator("intakeAt")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id}>
                <td className={styles.mono}>{row.serial}</td>
                <td title={row.skuName}>
                  <span className={styles.truncate}>{row.skuName}</span>
                </td>
                <td>{row.status}</td>
                <td>{row.lokasi}</td>
                <td>{row.grade ?? "—"}</td>
                {columns.map((c) => (
                  <td key={c.id}>{row.attrs[c.id] ?? "—"}</td>
                ))}
                {/* 02 §8: currency shows Rp once in the header, not on every
                    cell — so this formats the number without the prefix rather
                    than formatting with it and stripping it back off. (The
                    strip was also wrong: formatRupiah separates with a
                    non-breaking space, which /^Rp / never matched.) */}
                <td className={styles.numeric}>
                  {formatNumber(BigInt(row.landed))}
                </td>
                <td>{new Date(row.intakeAt).toLocaleDateString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 02 §8: no data and no matches are different problems with different
            fixes, so they get different messages and different next actions. */}
        {data !== undefined && data.rows.length === 0 ? (
          data.totalUnfiltered === 0 ? (
            <p className={styles.state} data-testid="empty-none">
              Belum ada unit. Tambah stok lewat Barang Masuk.
            </p>
          ) : (
            <p className={styles.state} data-testid="empty-nomatch">
              Tidak ada yang cocok.{" "}
              <button type="button" className={styles.reset} onClick={resetAll}>
                Reset filter
              </button>
            </p>
          )
        ) : null}
      </div>

      <nav className={styles.pager} aria-label="Halaman">
        <button
          type="button"
          className={styles.pageButton}
          disabled={page <= 1}
          onClick={() => update((n) => n.set("page", String(page - 1)))}
        >
          Sebelumnya
        </button>
        <span className={styles.pageInfo}>
          Halaman {page} dari {lastPage}
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={page >= lastPage}
          onClick={() => update((n) => n.set("page", String(page + 1)))}
        >
          Berikutnya
        </button>
      </nav>
    </section>
  );
}
