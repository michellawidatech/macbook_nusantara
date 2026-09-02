/**
 * Returns — one page for both directions.
 *
 * "From Customer" and "To Supplier" were two nav leaves for what staff think of
 * as one job: something is going back. They share a vocabulary (a serial, a
 * reason, a date, a credit) and differ only in which way the unit travels, so a
 * toggle is a truer model of them than two menu items (owner decision
 * 2026-08-24).
 *
 * History first, form behind a button — the same shape as Inbound and Stock
 * Opname. The two panels keep their own forms and their own history tables;
 * this page owns only the frame, the toggle and the Add button, so neither
 * side's logic had to be merged into the other's.
 */
import { useState } from "react";
import { Flex, Segmented } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { CustomerReturnPanel } from "./CustomerReturnPage";
import { SupplierReturnPanel } from "./SupplierReturnPage";
import { useTranslation } from "react-i18next";

type Side = "CUSTOMER" | "SUPPLIER";

export function ReturnsPage() {
  const { t } = useTranslation();
  const [side, setSide] = useState<Side>("CUSTOMER");
  const [addOpen, setAddOpen] = useState(false);

  return (
    <PageContainer
      title={t("returns.return", "Return")}
      actions={[
        {
          key: "add",
          label: t("returns.addReturn", "Add return"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAddOpen(true),
        },
      ]}
    >
      <Flex vertical gap={16}>
        <Segmented<Side>
          value={side}
          // Closing the drawer on a switch is deliberate: the two forms collect
          // different things, and leaving one open while the toggle says the
          // other would be a form claiming to do something it cannot.
          onChange={(v) => {
            setSide(v);
            setAddOpen(false);
          }}
          options={[
            {
              value: "CUSTOMER",
              label: t("returns.fromCustomer", "From customer"),
            },
            {
              value: "SUPPLIER",
              label: t("returns.toSupplier", "To supplier"),
            },
          ]}
          style={{ alignSelf: "flex-start" }}
        />

        {side === "CUSTOMER" ? (
          <CustomerReturnPanel
            addOpen={addOpen}
            onCloseAdd={() => setAddOpen(false)}
          />
        ) : (
          <SupplierReturnPanel
            addOpen={addOpen}
            onCloseAdd={() => setAddOpen(false)}
          />
        )}
      </Flex>
    </PageContainer>
  );
}
