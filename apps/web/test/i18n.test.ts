import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "../src/layouts/navigation.js";
import { CATALOGUES, isLanguage, LANGUAGES } from "../src/i18n/catalogue.js";
import { makeT } from "../src/i18n/translate.js";

describe("catalogue", () => {
  it("every nav label has Indonesian", () => {
    const labels = NAV_SECTIONS.flatMap((s) => [
      s.label,
      ...(s.children?.map((c) => c.label) ?? []),
    ]);
    for (const label of labels) {
      expect(CATALOGUES.id[label], `missing id for "${label}"`).toBeTypeOf(
        "string",
      );
    }
  });

  /**
   * Every `t("key", "English")` in the app, found by reading the source.
   *
   * Static analysis rather than a rendered sweep because there is no way to
   * render every branch of every page — a modal that only opens on an error, a
   * banner that only appears on a Shopee sale. The regex is deliberately
   * narrow: it matches the two-argument call this codebase always writes, and
   * the negative lookbehind stops it matching the tail of an identifier like
   * `addUnit(`.
   */
  function callSites(): Map<string, string> {
    const out = new Map<string, string>();
    const pattern =
      /(?<![A-Za-z0-9_$])t\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(name) && !full.includes("locales")) {
          const src = readFileSync(full, "utf8");
          for (const m of src.matchAll(pattern)) {
            out.set(m[1]!, m[2]!.replace(/\\"/g, '"'));
          }
        }
      }
    };
    walk(join(import.meta.dirname, "..", "src"));
    return out;
  }

  it("every string the app asks for has Indonesian", () => {
    // The owner asked for a full translation, not a partial one (2026-08-26).
    // `makeT` falls back to the English default when a key is missing, so an
    // untranslated string is invisible in English and shows up as an English
    // word in the middle of an Indonesian screen — exactly the failure nobody
    // reviewing in English would catch. This test is the review.
    const untranslated = [...callSites().keys()]
      .filter((key) => typeof CATALOGUES.id[key] !== "string")
      .sort();
    expect(untranslated).toEqual([]);
  });

  it("finds a realistic number of call sites, so a broken scan fails loudly", () => {
    // Guards the test above: if the regex ever stops matching, `untranslated`
    // becomes an empty list and the coverage check passes vacuously.
    expect(callSites().size).toBeGreaterThan(600);
  });

  it("translates the strings whose English IS the key", () => {
    // A second class of copy the scan above cannot see. Wizard step titles,
    // channel names and reason activities live in MODULE-level constants —
    // there is no hook in scope there — so they are written in English and run
    // through `t()` at render, exactly as the nav labels are. The call site
    // therefore reads `t(step.title)`, with no English literal for the regex to
    // find, and a missing entry would silently render English inside an
    // Indonesian wizard.
    const englishKeyed = [
      // StockOutPage STEPS + SOURCES
      "Sales detail",
      "Product",
      "Payment",
      "Offline (store)",
      // InboundFormPage STEPS
      "Order & payment",
      "Products",
      "Review",
      // InventoryPage OUT_STATUSES
      "Lost / written off",
      "On service",
      // SettingsPage REASON_ACTIVITIES
      "Stock adjustment",
      "Return from customer",
      "Return to supplier",
      // OpnameSessionPage KIND_TAG
      "Expected here",
      "Belongs elsewhere",
      "Not in system",
      // lib/inbound.ts INBOUND_STAGE_LABEL — the QC grid's tag. The Inbound
      // list's Stage column was one of these until 2026-09-15, when it became
      // a payment status. "On service" and "Returned to supplier" are already
      // above as Unit.status labels and share the key.
      "Pending",
      "Arrived",
      "In QC",
      "In inventory",
      "Closed",
      // lib/inbound.ts PO_PAYMENT_STATUS_LABEL — what replaced it. "Closed" is
      // already above and shares the key, which is the point: an order filed
      // away and an invoice part-paid are the same word in both places.
      "Open",
      "Paid in full",
      // lib/inbound.ts PO_STATUS_LABEL — the order's own status, editable
      // since 2026-09-15. "Arrived" is already above.
      "Draft",
      "Ordered",
      // mock/seed.ts PO_PAYMENT_FOR_LABEL — what a supplier payment settles.
      // "Products" is already above as an InboundFormPage step.
      "Shipping",
      "Tax",
    ];
    const untranslated = englishKeyed.filter(
      (key) => typeof CATALOGUES.id[key] !== "string",
    );
    expect(untranslated).toEqual([]);
  });

  it("no user-facing label is left outside t()", () => {
    /**
     * The gap the coverage test above cannot see.
     *
     * That one asks "does every key we look up have Indonesian?" — which says
     * nothing about a string that never reaches `t()` at all. Two whole classes
     * of those survived the first translation pass and shipped as English words
     * inside Indonesian tables: object literals written inline
     * (`{ title: "What", dataIndex: "what" }`, invisible to a line-anchored
     * regex) and labels shorter than three characters ("In", "On").
     *
     * So this reads the source for the props and keys that carry copy and
     * fails on any whose value is a bare string. The allow-list is the honest
     * part: each entry is a MODULE-level constant with no hook in scope, whose
     * English is deliberately its own catalogue key and which is run through
     * `t()` where it renders.
     */
    const KEYS =
      "title|label|placeholder|okText|cancelText|tooltip|enterButton" +
      "|description|addonAfter|emptyText|searchPlaceholder|facetLabel" +
      "|hint|content";
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_$])(${KEYS})\\s*[:=]\\s*"([^"\\\\]+)"`,
      "g",
    );
    // Brand names, currency and initialisms read the same in both languages.
    const untranslatable = new Set([
      "Shopee",
      "Instagram",
      "WhatsApp",
      "QRIS",
      "Cash",
      "Transfer",
      "Debit",
      "TUNAI",
      "OK",
      "Rp",
      "QC",
      "PO",
      "SKU",
    ]);
    /** `file` → the values it may legitimately leave in English. */
    const allowed: Record<string, string[]> = {
      // PageContainer translates its own title.
      "routes/chatbot/ChatbotPage.tsx": ["Chatbot"],
      // KIND_TAG
      "routes/opname/OpnameSessionPage.tsx": [
        "Expected here",
        "Belongs elsewhere",
        "Not in system",
      ],
      // REASON_ACTIVITIES
      "routes/settings/SettingsPage.tsx": [
        "Stock adjustment",
        "Return from customer",
        "Return to supplier",
      ],
      // OUT_STATUSES
      "routes/stock/InventoryPage.tsx": [
        "Lost / written off",
        "On service",
        "the unit is gone: shrinkage, damaged beyond sale, taken for internal use",
        "the unit is away at a repairer and is expected back",
      ],
      // STEPS + SOURCES
      "routes/stock/StockOutPage.tsx": [
        "Sales detail",
        "Product",
        "Payment",
        "Offline (store)",
      ],
      // STEPS
      "routes/inbound/InboundFormPage.tsx": [
        "Order & payment",
        "Products",
        "Review",
      ],
      // `statusOf` — a plain function, so no hook is in scope.
      "routes/discounts/DiscountsPage.tsx": [
        "Off",
        "Expired",
        "Scheduled",
        "Used up",
        "Running",
      ],
      // RANGES
      "routes/finance/CashflowPage.tsx": ["7 days", "30 days", "90 days"],
      // A class component: no hook, and it renders when the tree has thrown.
      "components/ErrorBoundary.tsx": ["Something broke on this page"],
    };

    const offenders: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const relPath = rel ? `${rel}/${name}` : name;
        if (statSync(full).isDirectory()) {
          walk(full, relPath);
        } else if (name.endsWith(".tsx")) {
          const src = readFileSync(full, "utf8");
          for (const m of src.matchAll(pattern)) {
            const value = m[2]!;
            if (untranslatable.has(value)) continue;
            if (!/[A-Za-z]{2}/.test(value)) continue; // "—", "%", "0"
            if (/^[A-Z_]+$/.test(value)) continue; // an enum token
            if (allowed[relPath]?.includes(value)) continue;
            offenders.push(`${relPath}: ${m[1]}="${value}"`);
          }
        }
      }
    };
    const root = join(import.meta.dirname, "..", "src");
    walk(join(root, "routes"), "routes");
    walk(join(root, "components"), "components");

    expect(offenders).toEqual([]);
  });

  it("offers exactly the languages isLanguage accepts", () => {
    for (const { value } of LANGUAGES) expect(isLanguage(value)).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe("translate", () => {
  it("resolves both key shapes against one catalogue", () => {
    const t = makeT("id");
    // An English nav label used as its own key — the PageContainer path.
    expect(t("Stock")).toBe("Stok");
    // A dotted key with an English default beside it — the xinchuan path.
    expect(t("common.delete", "Delete")).toBe("Hapus");
  });

  it("interpolates under a translated string", () => {
    expect(
      makeT("id")("deleteAction.confirmTitle", "Delete {{entity}}?", {
        entity: "iPhone 12",
      }),
    ).toBe("Hapus iPhone 12?");
  });

  it("takes vars from the options-object shape too", () => {
    expect(
      makeT("id")("fill.guide.progress", {
        defaultValue: "{{current}} of {{total}}",
        current: 1,
        total: 7,
      }),
    ).toBe("1 dari 7");
  });

  it("falls through an untranslated dotted key to its English default", () => {
    expect(makeT("id")("stockOut.subtitle", "Sell a unit")).toBe("Sell a unit");
  });

  it("falls through to the nav glossary when a dotted key is missing", () => {
    // The middle term of the lookup chain, and the reason a page body
    // translated later needs no catalogue entry of its own to start working.
    expect(makeT("id")("stockOut.title", "Stock Out")).toBe("Stok Keluar");
  });

  it("English is the inline defaults, plus the overrides", () => {
    const t = makeT("en");
    expect(t("nothing.here", "Whatever")).toBe("Whatever");
    expect(t("app.name", "Xinchuan CMS")).toBe("Macbook Nusantara");
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    expect(makeT("en")("x", "Hi {{name}}", {})).toBe("Hi {{name}}");
  });
});
