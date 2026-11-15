/**
 * The phone's bottom tabs (owner-approved mockup, 2026-11-16): Sell · Stock ·
 * Sales · Chat · More.
 *
 * Four places used all day, and More for everything else. An icon AND a word
 * on every tab — an icon row is a row of guesses — and every tab a real
 * `<Link>`, so a long-press can still open a place in a new tab (2026-09-21).
 *
 * Drawn only below `md` (`compact`); the desktop sider and the tablet drawer
 * are untouched. Laid out by `AppLayout` as the last child of the content
 * column, not `position: fixed`, so the content above it never has to know
 * its height — only the fixed `FooterToolbar` does, through
 * `--nusantara-content-bottom`.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge, theme } from "antd";
import {
  AppstoreOutlined,
  CodeSandboxOutlined,
  FileTextOutlined,
  MessageOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useChatWaiting } from "../hooks/useChatWaiting.js";
import { LAYOUT, TYPE, WEIGHT, Z } from "../theme/tokens";

export type TabKey = "sell" | "stock" | "sales" | "chat" | "more";

/** Where each tab goes. More is the menu of everything else. */
export const TAB_PATHS: Record<TabKey, string> = {
  sell: "/stock/out",
  stock: "/stock/inventory",
  sales: "/finance/transactions",
  chat: "/chat",
  more: "/more",
};

const under = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/**
 * Which tab a page belongs to. The four named places and anything below them
 * light their own tab; every other page — Inbound, Service, Settings — was
 * reached from More, so More is lit.
 */
export function activeTab(pathname: string): TabKey {
  if (under(pathname, TAB_PATHS.sell)) return "sell";
  if (under(pathname, TAB_PATHS.stock)) return "stock";
  if (under(pathname, TAB_PATHS.sales)) return "sales";
  if (under(pathname, TAB_PATHS.chat)) return "chat";
  return "more";
}

/** The tabs this person gets: Sales only with finance access. */
export function tabsFor(staff: { readonly canViewFinance: boolean }): TabKey[] {
  return (["sell", "stock", "sales", "chat", "more"] as const).filter(
    (k) => k !== "sales" || staff.canViewFinance,
  );
}

export function BottomTabBar({
  staff,
}: {
  readonly staff: { readonly canViewFinance: boolean };
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { count: waiting } = useChatWaiting();
  const {
    token: {
      colorBgContainer,
      colorBorderSecondary,
      colorPrimary,
      colorPrimaryBg,
      colorTextSecondary,
    },
  } = theme.useToken();
  const active = activeTab(pathname);

  const meta: Record<TabKey, { label: string; icon: ReactNode }> = {
    sell: { label: t("tabs.sell", "Sell"), icon: <TagOutlined /> },
    stock: { label: t("tabs.stock", "Stock"), icon: <CodeSandboxOutlined /> },
    sales: { label: t("tabs.sales", "Sales"), icon: <FileTextOutlined /> },
    chat: { label: t("tabs.chat", "Chat"), icon: <MessageOutlined /> },
    more: { label: t("tabs.more", "More"), icon: <AppstoreOutlined /> },
  };

  return (
    <nav
      aria-label={t("tabs.label", "Main")}
      className="nusantara-tab-bar"
      style={{
        flex: "0 0 auto",
        display: "flex",
        background: colorBgContainer,
        borderTop: `1px solid ${colorBorderSecondary}`,
        boxShadow: "0 -6px 18px rgba(6, 30, 24, 0.06)",
        paddingBottom: "env(safe-area-inset-bottom)",
        zIndex: Z.header,
      }}
    >
      {tabsFor(staff).map((key) => {
        const on = key === active;
        const { label, icon } = meta[key];
        const glyph = (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 30,
              borderRadius: 15,
              fontSize: 20,
              background: on ? colorPrimaryBg : "transparent",
            }}
          >
            {icon}
          </span>
        );
        return (
          <Link
            key={key}
            to={TAB_PATHS[key]}
            aria-current={on ? "page" : undefined}
            data-tab={key}
            style={{
              flex: 1,
              minWidth: 0,
              height: LAYOUT.tabBarHeight,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              color: on ? colorPrimary : colorTextSecondary,
              fontSize: TYPE.sm,
              fontWeight: on ? WEIGHT.strong : undefined,
              textDecoration: "none",
            }}
          >
            {key === "chat" && waiting > 0 ? (
              <Badge
                count={waiting}
                overflowCount={99}
                size="small"
                offset={[-10, 2]}
                title={t(
                  "chatWaiting.label",
                  "{{count}} chat(s) need a reply",
                  {
                    count: waiting,
                  },
                )}
              >
                {glyph}
              </Badge>
            ) : (
              glyph
            )}
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
