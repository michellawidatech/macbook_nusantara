/**
 * Returns — one page, one history table, two forms.
 *
 * "From Customer" and "To Supplier" were two nav leaves for what staff think of
 * as one job: something is going back (owner decision 2026-08-24). Since
 * 2026-09-23 they are also one TABLE — the two histories differed only in
 * which way the unit travelled, which is now a column.
 *
 * The Segmented that used to swap the whole page is gone with them. What is
 * left is two Add buttons, because the two forms genuinely collect different
 * things: a customer return names a sale and may go out again as an exchange,
 * a supplier return names an invoice and expects a credit.
 */
import { Flex } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { CustomerReturnPanel } from "./CustomerReturnPage";
import { SupplierReturnPanel } from "./SupplierReturnPage";
import { ReturnHistoryTable } from "./ReturnHistoryTable";
import { useTranslation } from "react-i18next";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { asBoolean } from "../../lib/draftGuards.js";

export function ReturnsPage() {
  const { t } = useTranslation();
  // Whether a form is open survives leaving the page — the customer form's
  // answers are kept on this device (2026-09-21).
  const [customerOpen, setCustomerOpen] = usePersistentState<boolean>(
    draftKey("returns.open"),
    false,
    asBoolean,
  );
  const [supplierOpen, setSupplierOpen] = usePersistentState<boolean>(
    draftKey("returns.openSupplier"),
    false,
    asBoolean,
  );

  return (
    <PageContainer
      title={t("returns.return", "Return")}
      actions={[
        {
          key: "customer",
          label: t("returns.fromCustomer", "From customer"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setCustomerOpen(true),
        },
        {
          key: "supplier",
          label: t("returns.toSupplier", "To supplier"),
          icon: <PlusOutlined />,
          onClick: () => setSupplierOpen(true),
        },
      ]}
    >
      <Flex vertical gap={16}>
        <ReturnHistoryTable />

        {/* Both panels are mounted, each drawing only its dialog now that the
            histories have moved into the table above. */}
        <CustomerReturnPanel
          addOpen={customerOpen}
          onCloseAdd={() => setCustomerOpen(false)}
          // A Shopee refund's "Record return" opens the same form.
          onOpenAdd={() => setCustomerOpen(true)}
        />
        <SupplierReturnPanel
          addOpen={supplierOpen}
          onCloseAdd={() => setSupplierOpen(false)}
        />
      </Flex>
    </PageContainer>
  );
}
