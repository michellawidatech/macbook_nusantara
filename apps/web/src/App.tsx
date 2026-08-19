/** Routing and the auth gate. The shell renders before data arrives (S8). */
import { Navigate, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { AppLayout } from "./layouts/AppLayout.js";
import { useSession } from "./lib/session.js";
import { LoginPage } from "./routes/LoginPage.js";
import { PurchaseOrderPage } from "./routes/stock/PurchaseOrderPage.js";
import { StockInPage } from "./routes/stock/StockInPage.js";
import { StockOutPage } from "./routes/stock/StockOutPage.js";
import { ReservationsPage } from "./routes/stock/ReservationsPage.js";
import { StockOpnamePage } from "./routes/stock/StockOpnamePage.js";
import { StockAdjustmentPage } from "./routes/stock/StockAdjustmentPage.js";
import { StockHistoryPage } from "./routes/stock/StockHistoryPage.js";
import { CustomerReturnPage } from "./routes/returns/CustomerReturnPage.js";
import { SupplierReturnPage } from "./routes/returns/SupplierReturnPage.js";
import { ProductsPage } from "./routes/products/ProductsPage.js";
import { DiscountFormPage } from "./routes/discounts/DiscountFormPage.js";
import { DiscountsPage } from "./routes/discounts/DiscountsPage.js";
import { ExpensePage } from "./routes/finance/ExpensePage.js";
import { CashflowPage } from "./routes/finance/CashflowPage.js";
import { TransactionsPage } from "./routes/finance/TransactionsPage.js";
import { ChatPage } from "./routes/chatbot/ChatPage.js";
import { KnowledgePage } from "./routes/chatbot/KnowledgePage.js";
import { CustomersPage } from "./routes/customers/CustomersPage.js";
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
        element={<Navigate to="/stock/adjustment" replace />}
      />
      <Route element={<AppLayout staff={staff} />}>
        <Route index element={<Navigate to="/stock/adjustment" replace />} />
        <Route path="/stock/po" element={<PurchaseOrderPage />} />
        <Route path="/stock/in" element={<StockInPage />} />
        <Route path="/stock/out" element={<StockOutPage />} />
        <Route path="/stock/reservations" element={<ReservationsPage />} />
        <Route path="/stock/opname" element={<StockOpnamePage />} />
        <Route path="/stock/adjustment" element={<StockAdjustmentPage />} />
        <Route path="/stock/history" element={<StockHistoryPage />} />
        <Route path="/return/customer" element={<CustomerReturnPage />} />
        <Route path="/return/supplier" element={<SupplierReturnPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/discounts/new" element={<DiscountFormPage />} />
        <Route path="/discounts" element={<DiscountsPage />} />
        <Route path="/finance/expense" element={<ExpensePage />} />
        <Route path="/finance/cashflow" element={<CashflowPage />} />
        <Route path="/finance/transactions" element={<TransactionsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/knowledge" element={<KnowledgePage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/stock/adjustment" replace />} />
      </Route>
    </Routes>
  );
}
