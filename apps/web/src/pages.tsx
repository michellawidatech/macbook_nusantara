/**
 * Every screen the shell can show, in one table (2026-09-15).
 *
 * `App.tsx` renders these as the router's own `<Route>`s, which is what makes
 * a URL resolve. Until 2026-09-21 the in-app tab strip rendered them a second
 * time, one mounted copy per open tab; the owner asked for the strip to go
 * (*"remove the tab view but the user must be able to drag the feature and
 * open it in another tab"*), so the browser's own tabs do that job and this is
 * a table with one reader.
 *
 * REDIRECTS ARE NOT HERE. `/stock/adjustment` is on its way to
 * `/stock/inventory`; redirects stay in `App.tsx`, which is where the router
 * needs them and where nothing else looks.
 */
import type { ReactNode } from "react";
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
import {
  PayablePage,
  ReceivablePage,
} from "./routes/finance/PayableReceivablePage.js";
import { ChatbotPage } from "./routes/chatbot/ChatbotPage.js";
import { CustomersPage } from "./routes/customers/CustomersPage.js";
import { SuppliersPage } from "./routes/suppliers/SuppliersPage.js";
import { SettingsPage } from "./routes/settings/SettingsPage.js";

/** One screen, at the path the router matches it on. */
export interface PageRoute {
  readonly path: string;
  readonly element: ReactNode;
}

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
  { path: "/discounts/:discountId/edit", element: <DiscountFormPage /> },
  { path: "/finance/income-expense", element: <IncomeExpensePage /> },
  { path: "/finance/transactions", element: <TransactionsPage /> },
  { path: "/finance/receivable", element: <ReceivablePage /> },
  { path: "/finance/payable", element: <PayablePage /> },
  { path: "/chat", element: <ChatbotPage /> },
  { path: "/customers", element: <CustomersPage /> },
  { path: "/suppliers", element: <SuppliersPage /> },
  { path: "/settings", element: <SettingsPage /> },
];
