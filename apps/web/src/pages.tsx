/**
 * Every screen the shell can put in a tab, in one table (2026-09-15).
 *
 * `App.tsx` renders these as the router's own `<Route>`s — which is what makes
 * a URL resolve — and `AppTabs.tsx` renders the same elements again, one per
 * open tab, so a tab that is not on screen stays mounted. One table rather
 * than two, because a page listed in one and not the other is either a route
 * with no tab or a tab with no route, and both fail silently.
 *
 * REDIRECTS ARE NOT HERE. `/stock/adjustment` is on its way to
 * `/stock/inventory`, and a tab opened for it would be a tab for an address
 * about to be replaced — see `visitLocation`. They stay in `App.tsx`, which is
 * where the router needs them and where nothing else looks.
 *
 * `isPage` is the question the tab layer asks about a URL, and it is answered
 * from this list rather than from a second copy of it.
 */
import { matchPath } from "react-router-dom";
import type { PageRoute } from "./layouts/tabs.js";
import { InventoryPage } from "./routes/stock/InventoryPage.js";
import { ReturnsPage } from "./routes/returns/ReturnsPage.js";
import { InboundPage } from "./routes/inbound/InboundPage.js";
import { OpnamePage } from "./routes/opname/OpnamePage.js";
import { OpnameSessionPage } from "./routes/opname/OpnameSessionPage.js";
import { InboundFormPage } from "./routes/inbound/InboundFormPage.js";
import { InboundDetailPage } from "./routes/inbound/InboundDetailPage.js";
import { StockOutPage } from "./routes/stock/StockOutPage.js";
import { ServicePage } from "./routes/stock/ServicePage.js";
import { ReservationsPage } from "./routes/reservations/ReservationsPage.js";
import { StockHistoryPage } from "./routes/stock/StockHistoryPage.js";
import { ProductsPage } from "./routes/products/ProductsPage.js";
import { DiscountFormPage } from "./routes/discounts/DiscountFormPage.js";
import { DiscountsPage } from "./routes/discounts/DiscountsPage.js";
import { IncomeExpensePage } from "./routes/finance/CashflowPage.js";
import { TransactionsPage } from "./routes/finance/TransactionsPage.js";
import { ReceivablesPage } from "./routes/finance/ReceivablesPage.js";
import { ChatbotPage } from "./routes/chatbot/ChatbotPage.js";
import { CustomersPage } from "./routes/customers/CustomersPage.js";
import { SuppliersPage } from "./routes/suppliers/SuppliersPage.js";
import { SettingsPage } from "./routes/settings/SettingsPage.js";

export const PAGE_ROUTES: readonly PageRoute[] = [
  { path: "/stock/inventory", element: <InventoryPage /> },
  { path: "/inbound", element: <InboundPage /> },
  { path: "/inbound/new", element: <InboundFormPage /> },
  { path: "/inbound/:poId", element: <InboundDetailPage /> },
  { path: "/stock/out", element: <StockOutPage /> },
  { path: "/reservations", element: <ReservationsPage /> },
  { path: "/stock/opname", element: <OpnamePage /> },
  { path: "/stock/opname/:opnameId", element: <OpnameSessionPage /> },
  { path: "/stock/history", element: <StockHistoryPage /> },
  { path: "/stock/service", element: <ServicePage /> },
  { path: "/returns", element: <ReturnsPage /> },
  { path: "/products", element: <ProductsPage /> },
  { path: "/discounts", element: <DiscountsPage /> },
  { path: "/discounts/new", element: <DiscountFormPage /> },
  { path: "/finance/income-expense", element: <IncomeExpensePage /> },
  { path: "/finance/transactions", element: <TransactionsPage /> },
  { path: "/finance/receivables", element: <ReceivablesPage /> },
  { path: "/chat", element: <ChatbotPage /> },
  { path: "/customers", element: <CustomersPage /> },
  { path: "/suppliers", element: <SuppliersPage /> },
  { path: "/settings", element: <SettingsPage /> },
];

/** Does this URL name a page — as opposed to a redirect, or nothing at all? */
export function isPagePath(pathname: string): boolean {
  return PAGE_ROUTES.some((r) => matchPath(r.path, pathname) !== null);
}
