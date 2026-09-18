/**
 * The tab strip, and the pages behind it (owner ask 2026-09-15).
 *
 * > *"The app should have tabs inside, so when I am in Inbound menu and I open
 * > product, it will open a tab inside the app, and when that menu is already
 * > opened, just redirect the tab without reopening new identical tab."*
 *
 * This replaces `<Outlet />` in `AppLayout`. The router still owns the URL —
 * every `navigate`, every `<Link>`, browser back and forward all work exactly
 * as before — and this layer watches where it lands: `visitLocation` puts the
 * tab that owns the new URL on screen, opening one only if the nav LEAF behind
 * it has none. So `/inbound/po-1` is the Inbound & QC tab showing an order,
 * not a second Inbound tab, which is the "without reopening new identical tab"
 * half of the ask. `layouts/tabs.ts` is the whole grammar and its own spec.
 *
 * ## Every open tab stays mounted
 *
 * That is the point of tabs rather than of a history list: a half-built sale
 * at the till has to survive a glance at Inventory. `MAX_TABS` is what stops
 * that becoming unbounded — twelve mounted pages, and the least recently used
 * one closes past it.
 *
 * ## How a hidden tab is kept honest
 *
 * A mounted page reads the router, and the router only knows one location — so
 * a hidden `/inbound/po-1` would ask `useParams()` and be handed the ACTIVE
 * tab's params. Each panel therefore renders inside its own pair of router
 * contexts:
 *
 * - **`UNSAFE_LocationContext`** so `useLocation` and `useSearchParams` answer
 *   with this tab's URL. Three pages read those.
 * - **`UNSAFE_RouteContext`**, reset to the router's own default, so the
 *   `<Routes>` below matches from `/` rather than from underneath the layout's
 *   route — which is also what stops React Router warning about a descendant
 *   `<Routes>` under a parent whose path has no trailing `*`.
 *
 * They are the escape hatch every keep-alive tab implementation uses, and the
 * reason they are safe here is that the subtree is a whole route tree: nothing
 * inside it is reaching PAST the boundary for a match.
 *
 * `useNavigate` is deliberately NOT intercepted. It navigates the real router,
 * which is right for the tab on screen and wrong for a hidden one — but no
 * page in this app navigates from an effect, so a hidden page never calls it.
 * `moveTab` in `tabs.ts` is the answer if one ever does, and stays tested and
 * dormain until then.
 *
 * ## Scans
 *
 * `lib/scanner.ts` has one stack for the document, so a mounted-but-hidden
 * Inbound page would take a scan aimed at the till. Each tab gets its own
 * stack (`createTabScanRegistry`) and only the active one is plugged into the
 * scanner — see `tabScope.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NavigationType,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { Location } from "react-router-dom";
import { Flex, Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { PAGE_ROUTES, isPagePath } from "../pages.js";
import {
  closeTab,
  hrefOf,
  readStoredTabs,
  tabLeafOf,
  visitLocation,
  writeStoredTabs,
  type TabRecord,
  type TabsState,
} from "./tabs.js";
import {
  TabActiveContext,
  TabScanContext,
  createTabScanRegistry,
  type TabScanRegistry,
} from "./tabScope.js";

/** The router's default route context — what a tree matching from `/` sees. */
const ROOT_ROUTE_CONTEXT = {
  outlet: null,
  matches: [],
  isDataRoute: false as const,
};

const routeElements = PAGE_ROUTES.map((r) => (
  <Route key={r.path} path={r.path} element={r.element} />
));

/**
 * One tab's page, mounted whether or not it is on screen.
 *
 * Hidden with `display: none` rather than by not rendering it: unmounting is
 * what tabs exist to avoid, and `hidden` on the wrapper also takes the subtree
 * out of the accessibility tree and out of tab order, so a screen reader and
 * the Tab key both see only the page somebody is looking at.
 */
function TabPanel({
  tab,
  active,
  registry,
}: {
  readonly tab: TabRecord;
  readonly active: boolean;
  readonly registry: TabScanRegistry;
}) {
  const location = useMemo<Location>(
    () => ({
      pathname: tab.location.pathname,
      search: tab.location.search,
      hash: tab.location.hash,
      state: tab.location.state ?? null,
      // Stable per tab, because React Router keys scroll restoration and
      // `useMatch` memoisation off it; a new key each render would look like
      // a navigation that never happened.
      key: tab.id,
    }),
    [tab.id, tab.location],
  );
  const locationValue = useMemo(
    () => ({ location, navigationType: NavigationType.Pop }),
    [location],
  );

  useEffect(() => {
    registry.setActive(active);
  }, [registry, active]);

  return (
    <div
      hidden={!active}
      // `hidden` alone is overridden by any `display` a stylesheet sets on the
      // element, and this one is a flex child of the content column.
      style={active ? undefined : { display: "none" }}
    >
      <UNSAFE_RouteContext.Provider value={ROOT_ROUTE_CONTEXT}>
        <UNSAFE_LocationContext.Provider value={locationValue}>
          <TabActiveContext.Provider value={active}>
            <TabScanContext.Provider value={registry}>
              <Routes>{routeElements}</Routes>
            </TabScanContext.Provider>
          </TabActiveContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_RouteContext.Provider>
    </div>
  );
}

export function AppTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<TabsState>(() =>
    readStoredTabs(isPagePath),
  );
  /**
   * One scan stack per tab, kept across re-renders and across a tab leaving
   * the screen. Keyed by tab id, and pruned when a tab closes — a registry for
   * a tab nobody can see is a listener nothing will ever release.
   */
  const registries = useRef(new Map<string, TabScanRegistry>());
  const registryFor = useCallback((id: string): TabScanRegistry => {
    const held = registries.current.get(id);
    if (held !== undefined) return held;
    const fresh = createTabScanRegistry();
    registries.current.set(id, fresh);
    return fresh;
  }, []);

  /*
   * The address bar is the input; the tabs follow it.
   *
   * Written this way round on purpose. Every existing screen navigates with
   * `navigate()` and `<Link>`, and a tab layer that wanted to be told about
   * each one would mean touching all of them — and would still miss browser
   * back, which is the case a person actually uses.
   */
  useEffect(() => {
    setState((prev) =>
      visitLocation(
        prev,
        {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          state: location.state,
        },
        isPagePath,
      ),
    );
  }, [location]);

  useEffect(() => {
    writeStoredTabs(state);
    for (const id of registries.current.keys()) {
      if (!state.tabs.some((tab) => tab.id === id)) registries.current.delete(id);
    }
  }, [state]);

  const items = state.tabs.map((tab) => {
    const leaf = tabLeafOf(tab.location.pathname);
    return {
      key: tab.id,
      label: t(leaf?.label ?? tab.leaf),
      // Every tab closable, the last one included: close means "throw this
      // away", and a form in the only open tab has to be abandonable like any
      // other. `closeTab` lands on a fresh home page.
      closable: true,
    };
  });

  return (
    <Flex vertical style={{ minHeight: 0, flex: 1 }}>
      {state.tabs.length > 0 && (
        <Tabs
          // The shell's own strip, named so it can be told from the `Tabs` a
          // PAGE renders — Settings has eleven of them, and every open page is
          // mounted, so "the tabs on screen" is not a question the DOM answers
          // by itself.
          className="nusantara-app-tabs"
          type="editable-card"
          hideAdd
          size="small"
          activeKey={state.activeId ?? undefined}
          items={items}
          onChange={(key) => {
            const tab = state.tabs.find((x) => x.id === key);
            // Navigating is all this does: the effect above is what moves the
            // tab, so clicking a tab and arriving at its URL any other way go
            // through exactly one path.
            if (tab) navigate(hrefOf(tab.location));
          }}
          onEdit={(key, action) => {
            if (action !== "remove" || typeof key !== "string") return;
            const { state: next, go } = closeTab(state, key);
            setState(next);
            if (go) navigate(hrefOf(go));
          }}
        />
      )}
      {state.tabs.map((tab) => (
        <TabPanel
          key={tab.id}
          tab={tab}
          active={tab.id === state.activeId}
          registry={registryFor(tab.id)}
        />
      ))}
    </Flex>
  );
}
