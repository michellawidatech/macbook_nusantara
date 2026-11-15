/**
 * More — everything that is not one of the phone's four daily tabs
 * (owner-approved mockup g1, 2026-11-16).
 *
 * The desktop menu's own sections, in its own order, read from the same
 * `navSectionsFor` — so finance access, the approver's Today and Approvals,
 * and every badge are exactly what the sider shows this person. Minus the
 * leaves that ARE tabs (the till, Inventory, Transaction History, the
 * chatbot): a second door to a place one tap away is a row to read past.
 *
 * Then the person's own preferences — appearance and language, spelled out —
 * the scanner's status and Sign out, which on a desktop live in the account
 * menu at the foot of the sider.
 *
 * A route rather than a sheet so the tab is lit and Back returns here. It
 * renders on a desktop too (a list of links is harmless), but nothing links
 * to it there.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Button, Card, Flex, Segmented, Typography, theme } from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DollarOutlined,
  ImportOutlined,
  LaptopOutlined,
  LogoutOutlined,
  PercentageOutlined,
  ProfileOutlined,
  RightOutlined,
  RollbackOutlined,
  ScheduleOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../components/PageContainer";
import { ScannerChip } from "../components/ScannerChip.js";
import { navSectionsFor, type NavBadgeKind } from "../layouts/navigation.js";
import { NavBadge } from "../layouts/NavBadge.js";
import { ChatHealthNotice } from "../layouts/ChatHealthNotice.js";
import { TAB_PATHS, tabsFor } from "../layouts/BottomTabBar.js";
import { useStaff } from "../hooks/useStaff.js";
import { useLogout } from "../lib/session.js";
import { LANGUAGES } from "../i18n/catalogue.js";
import { useLanguage } from "../i18n/useLanguage.js";
import { useColorScheme } from "../theme/useColorScheme";
import {
  NAV_GRADIENT,
  SPACE,
  TYPE,
  WEIGHT,
  type ColorSchemePreference,
} from "../theme/tokens";

/** A row's glyph, by where it goes. Anything unlisted takes its section's. */
const LEAF_ICONS: Record<string, ReactNode> = {
  "/today": <ScheduleOutlined />,
  "/inbound": <ImportOutlined />,
  "/stock/opname": <ProfileOutlined />,
  "/stock/history": <SearchOutlined />,
  "/stock/service": <ToolOutlined />,
  "/reservations": <CalendarOutlined />,
  "/returns": <RollbackOutlined />,
  "/products": <LaptopOutlined />,
  "/discounts": <PercentageOutlined />,
  "/finance/transactions": <ProfileOutlined />,
  "/finance/receivable": <WalletOutlined />,
  "/finance/payable": <SwapOutlined />,
  "/finance/income-expense": <DollarOutlined />,
  "/finance/reconciliation": <CheckSquareOutlined />,
  "/finance/profit-loss": <BarChartOutlined />,
  "/finance/approvals": <CheckSquareOutlined />,
  "/customers": <TeamOutlined />,
  "/suppliers": <ShopOutlined />,
  "/settings": <SettingOutlined />,
};

interface Row {
  readonly path: string;
  readonly label: string;
  readonly badge?: NavBadgeKind;
  readonly icon: ReactNode;
}

export function MorePage() {
  const { t } = useTranslation();
  const staff = useStaff();
  const logout = useLogout();
  const { language, setLanguage } = useLanguage();
  const { preference, resolved, setPreference } = useColorScheme();
  const {
    token: {
      colorPrimaryBg,
      colorPrimary,
      colorTextSecondary,
      colorBorderSecondary,
    },
  } = theme.useToken();

  const who = staff ?? { canViewFinance: false, canApprove: false };
  // The leaves that are tabs for THIS person — Transaction History is a row
  // here for nobody, since only a finance account can see either.
  const onTabs = new Set(
    tabsFor(who)
      .filter((k) => k !== "more")
      .map((k) => TAB_PATHS[k]),
  );

  // Sections with children are a heading and a card; a section that is
  // itself a leaf (Today, Customer, Supplier, Settings) joins a card of
  // such rows, in the order the sider lists them.
  const groups: { key: string; title?: string; rows: Row[] }[] = [];
  for (const s of navSectionsFor(who)) {
    if (s.children) {
      const rows = s.children
        .filter((c) => !onTabs.has(c.path))
        .map((c) => ({
          path: c.path,
          label: t(c.label),
          badge: c.badge,
          icon: LEAF_ICONS[c.path] ?? s.icon,
        }));
      if (rows.length > 0) groups.push({ key: s.key, title: t(s.label), rows });
      continue;
    }
    if (!s.path || onTabs.has(s.path)) continue;
    const row: Row = {
      path: s.path,
      label: t(s.label),
      badge: s.badge,
      icon: LEAF_ICONS[s.path] ?? s.icon,
    };
    const last = groups.at(-1);
    if (last && last.title === undefined) last.rows.push(row);
    else groups.push({ key: s.key, rows: [row] });
  }

  const initials = (staff?.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  const heading = (text: string) => (
    <Typography.Text
      strong
      style={{
        display: "block",
        color: colorTextSecondary,
        margin: `${SPACE.md}px ${SPACE.xs}px ${SPACE.sm}px`,
      }}
    >
      {text}
    </Typography.Text>
  );

  const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
    { value: "light", label: t("account.themeLight", "Light") },
    { value: "dark", label: t("account.themeDark", "Dark") },
    { value: "system", label: t("account.themeSystem", "System") },
  ];

  return (
    <PageContainer title={t("tabs.more", "More")}>
      <Flex vertical gap={0}>
        <ChatHealthNotice />
        {staff && (
          <Card
            styles={{ body: { padding: SPACE.md } }}
            style={{
              background: NAV_GRADIENT[resolved],
              border: "none",
            }}
          >
            <Flex align="center" gap={SPACE.md}>
              <Avatar
                size={48}
                style={{
                  background: "rgba(255,255,255,0.18)",
                  color: "#fff",
                  fontWeight: WEIGHT.strong,
                  flexShrink: 0,
                }}
              >
                {initials || "?"}
              </Avatar>
              <Flex vertical style={{ minWidth: 0 }}>
                <Typography.Text
                  ellipsis
                  style={{
                    color: "#fff",
                    fontSize: TYPE.lg,
                    fontWeight: WEIGHT.strong,
                  }}
                >
                  {staff.name}
                </Typography.Text>
                <Typography.Text style={{ color: "rgba(255,255,255,0.8)" }}>
                  {staff.role === "OWNER"
                    ? t("staff.owner", "Owner")
                    : t("staff.staff", "Staff")}
                </Typography.Text>
              </Flex>
            </Flex>
          </Card>
        )}

        {groups.map((g) => (
          <div key={g.key}>
            {g.title !== undefined ? (
              heading(g.title)
            ) : (
              <div style={{ height: SPACE.md }} />
            )}
            <Card styles={{ body: { padding: 0 } }}>
              <nav aria-label={g.title}>
                {g.rows.map((r, i) => (
                  <Link
                    key={r.path}
                    to={r.path}
                    className="nusantara-more-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: SPACE.md,
                      minHeight: 56,
                      padding: `${SPACE.sm}px ${SPACE.md}px`,
                      color: "inherit",
                      textDecoration: "none",
                      borderTop:
                        i === 0
                          ? undefined
                          : `1px solid ${colorBorderSecondary}`,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: colorPrimaryBg,
                        color: colorPrimary,
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      {r.icon ?? <AppstoreOutlined />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: TYPE.lg }}>
                      {r.label}
                      {r.badge !== undefined && <NavBadge kind={r.badge} />}
                    </span>
                    <RightOutlined
                      aria-hidden
                      style={{ color: colorTextSecondary }}
                    />
                  </Link>
                ))}
              </nav>
            </Card>
          </div>
        ))}

        {heading(t("more.preferences", "Preferences"))}
        <Card>
          <Flex vertical gap={SPACE.md}>
            <Flex vertical gap={SPACE.xs}>
              <Typography.Text strong>
                {t("account.appearance", "Appearance")}
              </Typography.Text>
              <Segmented<ColorSchemePreference>
                block
                aria-label={t("account.appearance", "Appearance")}
                value={preference}
                onChange={setPreference}
                options={SCHEMES}
              />
            </Flex>
            <Flex vertical gap={SPACE.xs}>
              <Typography.Text strong>
                {t("account.language", "Language")}
              </Typography.Text>
              <Segmented
                block
                aria-label={t("account.language", "Language")}
                value={language}
                onChange={(v) => setLanguage(v as typeof language)}
                // Endonyms, never translated — catalogue.ts says why.
                options={LANGUAGES.map(({ value, label }) => ({
                  value,
                  label,
                }))}
              />
            </Flex>
            <ScannerChip />
          </Flex>
        </Card>

        <Button
          danger
          block
          size="large"
          icon={<LogoutOutlined />}
          loading={logout.isPending}
          onClick={() => logout.mutate()}
          style={{ marginTop: SPACE.lg }}
        >
          {t("account.signOut", "Sign out")}
        </Button>
      </Flex>
    </PageContainer>
  );
}
