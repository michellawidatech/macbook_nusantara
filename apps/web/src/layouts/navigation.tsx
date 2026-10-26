/**
 * The single source of truth for the sidebar and the router.
 *
 * Owner IA of 2026-08-15, amended 2026-08-20, 2026-08-24 and again 2026-08-26:
 * Stock / Product / Financial & Report / Chatbot / Customer / Settings.
 *
 * The 2026-08-26 round is a flattening. Reservation and Return had each been
 * promoted to a top-level section; both went back under Stock, because with
 * nine sections the sidebar had stopped being a list anyone could take in at a
 * glance and both name a movement of stock. Discount joined Product for the
 * same reason, and the two finance screens took the name the owner uses for
 * them out loud — "Financial & Report".
 *
 * Two merges also land here, and they are why the leaf list is shorter than
 * the page list:
 *
 * - **Inventory & Stock Movement** is one screen. It was two views of one
 *   question — how many do we have, and which serials are they — and the
 *   answer now lives in one table that expands from the product to its
 *   serials.
 * - **Chatbot** is one screen. The inbox and the knowledge base were two menu
 *   items for one job: what the bot said, and what it knows to say.
 *
 * Every path either merge retired still resolves — App.tsx redirects it —
 * because a bookmark should not break on an IA change.
 */
import type { ReactNode } from "react";
import {
  AppstoreOutlined,
  CommentOutlined,
  DollarOutlined,
  SettingOutlined,
  DatabaseOutlined,
  ShopOutlined,
  TeamOutlined,
} from "@ant-design/icons";

export interface NavLeaf {
  readonly path: string;
  readonly label: string;
  /**
   * A count drawn beside the label — work waiting behind that leaf. Named
   * here, drawn by `NavBadge`, so the tree stays the one place that says
   * what the nav holds.
   */
  readonly badge?: NavBadgeKind;
}
/** What a leaf's count counts. One so far. */
export type NavBadgeKind = "qcWaiting";
export interface NavSection {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Sections without children are themselves a leaf at `path`. */
  readonly path?: string;
  readonly children?: readonly NavLeaf[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "stock",
    label: "Stock",
    icon: <DatabaseOutlined />,
    children: [
      // Intake first, in the order stock actually moves through the shop:
      // it arrives, it is sold, it is counted. One entry for the whole intake
      // job — Purchase Order and Stock In (QC) were two menu items for two
      // halves of it, which left "where is that order up to?" with no screen
      // that could answer it.
      //
      // The badge is the units still waiting for QC across every invoice
      // (owner ask 2026-10-26) — the one number that says the bench is
      // behind, visible from any screen.
      { path: "/inbound", label: "Inbound & QC", badge: "qcWaiting" },
      // The owner's own word for the till. "Point of Sale" named the software
      // category; "New Transaction" names what the button does.
      { path: "/stock/out", label: "New Transaction" },
      // "Inventory" since 2026-09-23 (owner ask). The merge of 2026-08-26 is
      // unchanged — one screen, one table, the adjustments behind its own
      // buttons — but the name was describing the merge rather than the page.
      { path: "/stock/inventory", label: "Inventory" },
      { path: "/stock/opname", label: "Stock Opname" },
      { path: "/stock/history", label: "S/N Tracking" },
      // Machines away at a repairer (owner ask 2026-09-08). Under Stock
      // because that is what they are: stock the shop owns, cannot sell, and
      // is spending money on.
      { path: "/stock/service", label: "Service" },
      // Back under Stock on 2026-08-26 after four days as sections of their
      // own. Both are a unit moving: onto hold, or back out of the shop.
      { path: "/reservations", label: "Reservation" },
      { path: "/returns", label: "Return" },
    ],
  },
  {
    key: "products",
    label: "Product",
    icon: <AppstoreOutlined />,
    children: [
      { path: "/products", label: "Master Product" },
      { path: "/discounts", label: "Discount" },
    ],
  },
  {
    key: "finance",
    label: "Financial & Report",
    icon: <DollarOutlined />,
    children: [
      // History first: chasing a receipt is the daily job, and reading the
      // ledger is the monthly one.
      { path: "/finance/transactions", label: "Transaction History" },
      // Pending Payment was its own leaf from 2026-09-08 and folded into
      // Transaction History on 2026-10-22 (owner ask): a payout's deductions
      // are entered under the payment in Edit transaction, and the Shopee
      // upload is a button on that page. `/finance/receivables` redirects.
      // Piutang and utang, each its own leaf (owner ask 2026-09-22 — they
      // were two tabs of one page for a day). Not tabs of the one above:
      // that screen's first table is money a MARKETPLACE is holding, which is
      // not a debt in either direction. Receivable first, because chasing a
      // customer is the daily job and paying a supplier the weekly one.
      { path: "/finance/receivable", label: "Receivable" },
      { path: "/finance/payable", label: "Payable" },
      { path: "/finance/income-expense", label: "Income & Expense" },
      // Laba Rugi, after Olsera's template (owner ask 2026-10-23).
      { path: "/finance/profit-loss", label: "Profit & Loss" },
    ],
  },
  {
    // One leaf since the inbox and the knowledge base merged (2026-08-26).
    key: "chatbot",
    label: "Chatbot",
    icon: <CommentOutlined />,
    path: "/chat",
  },
  {
    key: "customers",
    label: "Customer",
    icon: <TeamOutlined />,
    path: "/customers",
  },
  {
    /*
     * Suppliers, as an account rather than an address book (owner ask
     * 2026-09-08).
     *
     * Top level, beside Customer, because it is Customer's mirror: one is
     * money coming in and the other money going out, and the shop reads both
     * before deciding what to transfer. It sat in Settings, which is where a
     * supplier's PHONE NUMBER belongs and not where a Rp30jt deposit does.
     */
    key: "suppliers",
    label: "Supplier",
    icon: <ShopOutlined />,
    path: "/suppliers",
  },
  {
    key: "settings",
    label: "Settings",
    icon: <SettingOutlined />,
    path: "/settings",
  },
];

/**
 * Financial & Report is for the accounts the owner named (2026-10-16: "only
 * Ersen and Dina") — `Staff.canViewFinance`. Everybody else is not shown the
 * section, and its addresses answer with a refusal (App.tsx). Neither is the
 * control: the API sends them none of the money behind it.
 */
export const FINANCE_SECTION_KEY = "finance";

export function isFinancePath(pathname: string): boolean {
  return pathname === "/finance" || pathname.startsWith("/finance/");
}

/** The sections this person may see. */
export function navSectionsFor(staff: {
  readonly canViewFinance: boolean;
}): readonly NavSection[] {
  return staff.canViewFinance
    ? NAV_SECTIONS
    : NAV_SECTIONS.filter((s) => s.key !== FINANCE_SECTION_KEY);
}

/**
 * Longest-prefix match, so a child route highlights the section that owns it —
 * /discounts/new lights up Discount rather than nothing.
 *
 * This is the only consumer of the nav tree outside the sidebar itself. The
 * breadcrumb that used to read it was removed on 2026-08-26 (owner decision):
 * with the deepest route two levels down, every crumb trail restated the
 * highlighted sidebar item and the page's own title, and spent a line of
 * vertical space saying nothing the screen did not already say twice.
 */
export function matchLeaf(
  pathname: string,
): { section: NavSection; leaf?: NavLeaf } | null {
  let best: { section: NavSection; leaf?: NavLeaf; len: number } | null = null;
  for (const s of NAV_SECTIONS) {
    const leaves =
      s.children ?? (s.path ? [{ path: s.path, label: s.label }] : []);
    for (const leaf of leaves) {
      if (pathname === leaf.path || pathname.startsWith(`${leaf.path}/`)) {
        if (!best || leaf.path.length > best.len) {
          best = {
            section: s,
            leaf: s.children ? leaf : undefined,
            len: leaf.path.length,
          };
        }
      }
    }
  }
  return best && { section: best.section, leaf: best.leaf };
}
