/**
 * The shell: nav + header + content, after xinchuan's AppLayout but trimmed —
 * accordion menu, user dropdown.
 *
 * The nav is the same `<Menu>` in both layouts, mounted in a Sider on a
 * desktop and in a Drawer on a phone. One menu, two containers: a second copy
 * of the item list is how a mobile nav ends up one route behind the real one.
 * `useLayoutMode` owns the breakpoint — see that file for why it is `lg` and
 * not a rail.
 */
import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Flex,
  Layout,
  Menu,
  Typography,
  theme,
} from "antd";
import { LogoutOutlined, MenuOutlined, UserOutlined } from "@ant-design/icons";
import { NAV_SECTIONS, matchLeaf } from "./navigation.js";
import { useLayoutMode } from "./useLayoutMode.js";
import { LAYOUT, SPACE, TYPE, WEIGHT, Z } from "../theme/tokens";
import { useLogout, type Staff } from "../lib/session.js";

export function AppLayout({ staff }: { staff: Staff }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const { nav, compact } = useLayoutMode();
  const {
    token: { colorBgContainer, colorBorderSecondary, colorPrimary },
  } = theme.useToken();

  const match = matchLeaf(pathname);
  const selectedKey = match?.leaf?.path ?? match?.section.path ?? "";
  const [openKeys, setOpenKeys] = useState<string[]>(
    match?.section.children ? [match.section.key] : [],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Closing on navigation is not enough: the drawer must also go away when the
  // viewport grows past `lg`, or a rotated tablet keeps a scrim over a sider
  // that is now visible behind it.
  useEffect(() => {
    if (nav === "sider") setDrawerOpen(false);
  }, [nav]);

  const items = useMemo(
    () =>
      NAV_SECTIONS.map((s) => ({
        key: s.children ? s.key : (s.path ?? s.key),
        icon: s.icon,
        label: s.label,
        children: s.children?.map((c) => ({ key: c.path, label: c.label })),
      })),
    [],
  );

  const brand = (
    <Typography.Text
      style={{
        fontSize: TYPE.lg,
        fontWeight: WEIGHT.strong,
        color: colorPrimary,
      }}
    >
      Nusantara POS
    </Typography.Text>
  );

  const menu = (
    <Menu
      mode="inline"
      style={{ borderInlineEnd: "none" }}
      items={items}
      selectedKeys={selectedKey ? [selectedKey] : []}
      openKeys={openKeys}
      // Accordion: one section open at a time keeps the list scannable.
      onOpenChange={(keys) => setOpenKeys(keys.slice(-1))}
      onClick={({ key }) => {
        if (key.startsWith("/")) {
          navigate(key);
          setDrawerOpen(false);
        }
      }}
    />
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {nav === "sider" && (
        <Layout.Sider
          width={LAYOUT.siderWidth}
          style={{
            background: colorBgContainer,
            borderRight: `1px solid ${colorBorderSecondary}`,
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "auto",
            zIndex: Z.sider,
          }}
        >
          <Flex
            align="center"
            gap={SPACE.sm}
            style={{ height: LAYOUT.headerHeight, paddingInline: SPACE.lg }}
          >
            {brand}
          </Flex>
          {menu}
        </Layout.Sider>
      )}

      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        // Not full-width: leaving a strip of the page visible is what tells a
        // first-time user the drawer is a layer they can dismiss by tapping
        // beside it. 280 is wide enough for the longest leaf label.
        width={280}
        title={brand}
        styles={{ body: { padding: 0 } }}
      >
        {menu}
      </Drawer>

      <Layout>
        <Layout.Header
          style={{
            background: colorBgContainer,
            borderBottom: `1px solid ${colorBorderSecondary}`,
            height: LAYOUT.headerHeight,
            paddingInline: compact ? LAYOUT.contentPadding.compact : SPACE.xl,
            display: "flex",
            alignItems: "center",
            // The hamburger claims the left, so the user block can no longer
            // rely on flex-end alone to sit opposite it.
            justifyContent: "space-between",
            gap: SPACE.sm,
            position: "sticky",
            top: 0,
            zIndex: Z.header,
          }}
        >
          {nav === "drawer" ? (
            <Flex align="center" gap={SPACE.sm}>
              <Button
                type="text"
                icon={<MenuOutlined />}
                aria-label="Open navigation"
                onClick={() => setDrawerOpen(true)}
              />
              {brand}
            </Flex>
          ) : (
            <span />
          )}

          <Dropdown
            menu={{
              items: [
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "Sign out",
                  onClick: () => logout.mutate(),
                },
              ],
            }}
          >
            <Flex align="center" gap={SPACE.sm} style={{ cursor: "pointer" }}>
              <Avatar size="small" icon={<UserOutlined />} />
              {/* The name is the first thing to go on a 375px header — the
                  avatar still identifies who is signed in, and the menu behind
                  it still says the rest. */}
              {!compact && <Typography.Text>{staff.name}</Typography.Text>}
            </Flex>
          </Dropdown>
        </Layout.Header>

        <Layout.Content
          style={{
            display: "flex",
            flexDirection: "column",
            // The same constant FooterToolbar bleeds by, so the two cannot
            // drift — and 16px rather than 32 on a phone, where a 375px screen
            // cannot spend a fifth of its width on gutters.
            padding: compact
              ? LAYOUT.contentPadding.compact
              : LAYOUT.contentPadding.comfortable,
            // Room for the bottom-right float button to clear the last row of
            // content, and for the home indicator on a notched phone.
            paddingBottom: `calc(${
              compact
                ? LAYOUT.contentPadding.compact
                : LAYOUT.contentPadding.comfortable
            }px + env(safe-area-inset-bottom))`,
            maxWidth: LAYOUT.contentMaxWidth,
            width: "100%",
            // Without this, a wide table inside a fixed-width flex child
            // refuses to shrink and the whole document scrolls sideways —
            // the classic min-content floor on a flex item.
            minWidth: 0,
          }}
        >
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
