/**
 * Product categories, and the one fact the app branches on: whether a category
 * is tracked machine by machine or merely counted.
 *
 * > *"Accessories do not have serial number, and in stock opname, they will
 * > only be counted and validated by qty, not serial."* (owner ask 2026-09-15)
 *
 * A switch rather than a hard-coded "Accessory", because `wh-4` taught this
 * codebase what happens when a shop's own data is read as a constant: the next
 * shop's data stops working, and nobody can see why. A shop that starts
 * counting cables says so here.
 *
 * ## Why the list is not editable beyond the switch
 *
 * A category is born by somebody typing it on a product, which is the door it
 * has always had, and nothing here creates or removes one. The margin band is
 * its own screen. What this page adds is the switch and a plain count of how
 * many products sit under each, so the person flicking it can see what it will
 * affect.
 *
 * ⚠️ The switch changes what QC ASKS FOR from now on. Machines already taken
 * in keep the serials they were given — they are what the ledger names — which
 * is why turning tracking off does not go back and rewrite anything.
 */
import { Alert, Card, Flex, Switch, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { mutate, useDb } from "../../mock/store.js";
import { countedCategories } from "../../lib/serialTracking.js";

export function CategorySettings() {
  const { t } = useTranslation();
  const db = useDb();

  const rows = db.categories.map((c) => ({
    ...c,
    products: db.models.filter((m) => m.category === c.name).length,
  }));

  return (
    <Card>
      <Flex vertical gap={16}>
        <Alert
          type="info"
          showIcon
          title={t(
            "settings.categoryTrackingTitle",
            "Which products carry a serial",
          )}
          description={t(
            "settings.categoryTrackingBody",
            "A tracked category is identified machine by machine: QC asks for the serial, and a stock take scans each one. A counted category is not — an accessory has no serial anybody reads, so QC takes it in without one and a stock take answers with a number. Machines already in stock keep the serials they have.",
          )}
        />
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rows}
          columns={[
            {
              title: t("settings.category", "Category"),
              dataIndex: "name",
            },
            {
              title: t("settings.categoryProducts", "Products"),
              dataIndex: "products",
              align: "right" as const,
              width: 120,
            },
            {
              title: t("settings.trackedBySerial", "Tracked by serial"),
              key: "tracks",
              align: "right" as const,
              width: 180,
              render: (_: unknown, r: (typeof rows)[number]) => (
                <Switch
                  checked={r.tracksSerial}
                  aria-label={t(
                    "settings.trackedBySerialAria",
                    "Track {{name}} by serial",
                    { name: r.name },
                  )}
                  onChange={(on) =>
                    mutate((d) => {
                      const row = d.categories.find((c) => c.id === r.id);
                      if (row) row.tracksSerial = on;
                    })
                  }
                />
              ),
            },
          ]}
        />
        {countedCategories(db).length > 0 && (
          <Typography.Text type="secondary">
            {t("settings.countedNow", "Counted by quantity: {{names}}", {
              names: countedCategories(db).join(", "),
            })}
          </Typography.Text>
        )}
      </Flex>
    </Card>
  );
}
