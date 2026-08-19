/**
 * The single source of truth for the sidebar, the breadcrumb and the router.
 * Owner IA of 2026-08-15: Stock / Return / Product / Discount / Finance /
 * Chatbot / Customer / Settings.
 */
import type { ReactNode } from "react";
import {
  AppstoreOutlined,
  CommentOutlined,
  DollarOutlined,
  PercentageOutlined,
  RollbackOutlined,
  SettingOutlined,
  DatabaseOutlined,
  TeamOutlined,
} from "@ant-design/icons";

export interface NavLeaf {
  readonly path: string;
  readonly label: string;
}
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
      { path: "/stock/po", label: "Purchase Order" },
      { path: "/stock/in", label: "Stock In (QC)" },
      { path: "/stock/out", label: "Stock Out" },
      { path: "/stock/reservations", label: "Reservations" },
      { path: "/stock/opname", label: "Stock Opname" },
      { path: "/stock/adjustment", label: "Stock Adjustment" },
      { path: "/stock/history", label: "S/N Tracking" },
    ],
  },
  {
    key: "return",
    label: "Return",
    icon: <RollbackOutlined />,
    children: [
      { path: "/return/customer", label: "From Customer" },
      { path: "/return/supplier", label: "To Supplier" },
    ],
  },
  {
    key: "products",
    label: "Product",
    icon: <AppstoreOutlined />,
    path: "/products",
  },
  {
    key: "discount",
    label: "Discount",
    icon: <PercentageOutlined />,
    children: [
      { path: "/discounts/new", label: "Add Discount" },
      { path: "/discounts", label: "Manage Discounts" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: <DollarOutlined />,
    children: [
      { path: "/finance/expense", label: "Expenses" },
      { path: "/finance/cashflow", label: "Cashflow" },
      { path: "/finance/transactions", label: "Transaction History" },
    ],
  },
  {
    key: "chatbot",
    label: "Chatbot",
    icon: <CommentOutlined />,
    children: [
      { path: "/chat", label: "Chat Inbox" },
      { path: "/chat/knowledge", label: "Knowledge" },
    ],
  },
  {
    key: "customers",
    label: "Customer",
    icon: <TeamOutlined />,
    path: "/customers",
  },
  {
    key: "settings",
    label: "Settings",
    icon: <SettingOutlined />,
    path: "/settings",
  },
];

/** Longest-prefix match so /discounts/new highlights Add, not Manage. */
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

/** Breadcrumb labels for a path the sidebar owns; [] otherwise. */
export function navTrail(pathname: string): string[] {
  const m = matchLeaf(pathname);
  if (!m) return [];
  return m.leaf ? [m.section.label, m.leaf.label] : [m.section.label];
}
