/** Routing and the auth gate. The shell renders before data arrives (S8). */
import { Navigate, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { AppLayout } from "./layouts/AppLayout.js";
import { useSession } from "./lib/session.js";
import { LoginPage } from "./routes/LoginPage.js";
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

export function App() {
  const session = useSession();

  if (session.isPending) {
    return <Spin style={{ margin: 48 }} />;
  }
  const staff = session.data ?? null;
  if (staff === null) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route
        path="/login"
        element={<Navigate to="/stock/inventory" replace />}
      />
      <Route element={<AppLayout staff={staff} />}>
        {/* The shift opens on stock, which is the screen a shift opens on. */}
        <Route index element={<Navigate to="/stock/inventory" replace />} />
        <Route path="/stock/inventory" element={<InventoryPage />} />
        {/* Inbound merged the Purchase Order and Stock In (QC) screens on
            2026-08-24. Both old paths still resolve, because a bookmark should
            not break on an IA change. */}
        <Route path="/inbound" element={<InboundPage />} />
        <Route path="/inbound/new" element={<InboundFormPage />} />
        <Route path="/inbound/:poId" element={<InboundDetailPage />} />
        <Route path="/stock/po" element={<Navigate to="/inbound" replace />} />
        <Route path="/stock/in" element={<Navigate to="/inbound" replace />} />
        <Route path="/stock/out" element={<StockOutPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        {/* Reservation left the Stock section on 2026-08-20. The old path is
            kept as a redirect rather than deleted: it is what every bookmark,
            every pasted link in the staff group chat and every one of this
            app's own older screens still points at. */}
        <Route
          path="/stock/reservations"
          element={<Navigate to="/reservations" replace />}
        />
        <Route path="/stock/opname" element={<OpnamePage />} />
        <Route path="/stock/opname/:opnameId" element={<OpnameSessionPage />} />
        {/* Inventory absorbed Stock Movement on 2026-08-26 — one table, from
            the product down to the serial. The old path redirects. */}
        <Route
          path="/stock/adjustment"
          element={<Navigate to="/stock/inventory" replace />}
        />
        <Route path="/stock/history" element={<StockHistoryPage />} />
        {/* The service bench (owner ask 2026-09-08). A machine at a repairer
            is stock the shop owns, cannot sell, and is paying for — none of
            which Inventory can show as a queue. */}
        <Route path="/stock/service" element={<ServicePage />} />
        {/* One page, both directions (2026-08-24). The old leaf paths still
            resolve so bookmarks survive the merge. */}
        <Route path="/returns" element={<ReturnsPage />} />
        <Route
          path="/return/customer"
          element={<Navigate to="/returns" replace />}
        />
        <Route
          path="/return/supplier"
          element={<Navigate to="/returns" replace />}
        />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/discounts/new" element={<DiscountFormPage />} />
        <Route path="/discounts" element={<DiscountsPage />} />
        {/* Finance went from three screens to two (2026-08-24): one ledger for
            every movement, and Transaction History for sales alone. */}
        <Route path="/finance/income-expense" element={<IncomeExpensePage />} />
        <Route
          path="/finance/expense"
          element={<Navigate to="/finance/income-expense" replace />}
        />
        <Route
          path="/finance/cashflow"
          element={<Navigate to="/finance/income-expense" replace />}
        />
        <Route path="/finance/transactions" element={<TransactionsPage />} />
        {/* Pending marketplace money and customer debts, split apart (owner
            ask 2026-09-08). `Order.settled` used to cover both with one
            boolean, so nobody could answer either question. */}
        <Route path="/finance/receivables" element={<ReceivablesPage />} />
        {/* The inbox and the knowledge base are two tabs of one page since
            2026-08-26. The old leaf path still resolves. */}
        <Route path="/chat" element={<ChatbotPage />} />
        <Route
          path="/chat/knowledge"
          element={<Navigate to="/chat" replace />}
        />
        <Route path="/customers" element={<CustomersPage />} />
        {/* Suppliers left Settings on 2026-09-08 (owner ask): what the shop
            owes them, what it has deposited, and which invoice a deposit
            settles are not settings. Settings keeps the contact details. */}
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/stock/inventory" replace />} />
      </Route>
    </Routes>
  );
}
