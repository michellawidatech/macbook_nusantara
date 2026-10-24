/**
 * One serial's life, as a timeline.
 *
 * Extracted so the stock opname's scan view can show it beside the count. That
 * pairing is the point of the split screen: the question a counter asks about
 * an odd serial is never "what is this?" but "how did it get here?", and the
 * event ledger is the only thing that answers it.
 *
 * Deliberately read-only and self-contained — it takes a serial and renders
 * what the ledger says, with no assumption about which page it is on.
 */
import { Empty, Flex, Tag, Timeline, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useDb } from "../mock/store.js";
import { fmtDateTime } from "../lib/format.js";
import { labelOf, UNIT_EVENT, UNIT_STATUS } from "../i18n/enumLabels.js";
import { EnumTag } from "./EnumTag";
import { warehouseLabel } from "../lib/warehouses.js";

export function UnitTimeline({ serial }: { serial: string | null }) {
  const db = useDb();
  const { t } = useTranslation();

  if (!serial) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t(
          "timeline.scanOrSelectASerial",
          "Scan or select a serial to see its history.",
        )}
      />
    );
  }

  const unit = db.units.find((u) => u.serial === serial);
  const events = db.events
    .filter((e) => e.serial === serial)
    .sort((a, b) => b.seq - a.seq);

  if (!unit && events.length === 0) {
    return (
      <Flex vertical gap={8}>
        <Typography.Text strong style={{ fontFamily: "monospace" }}>
          {serial}
        </Typography.Text>
        {/* The genuinely unknown case, and worth saying plainly: this is not a
            unit that moved somewhere unexpected, it is one the system has never
            heard of. */}
        <Typography.Text type="secondary">
          This serial is not in the system at all — no purchase, no intake, no
          history. It may be a typo, or stock that was never booked in.
        </Typography.Text>
      </Flex>
    );
  }

  const sku = unit && db.skus.find((s) => s.id === unit.skuId);
  const where = unit && db.warehouses.find((w) => w.id === unit.locationId);

  return (
    <Flex vertical gap={12}>
      <Flex vertical gap={2}>
        <Typography.Text strong style={{ fontFamily: "monospace" }}>
          {serial}
        </Typography.Text>
        {sku && (
          <Typography.Text>
            {sku.name} {sku.variantLabel}
          </Typography.Text>
        )}
        {unit && (
          <Flex gap={6} align="center" wrap>
            <EnumTag map={UNIT_STATUS} value={unit.status} />
            {/* Where the system believes it is — which is exactly the fact a
                counter needs when the unit is standing in a different room. */}
            <Tag>{where ? warehouseLabel(where) : "Unknown warehouse"}</Tag>
          </Flex>
        )}
      </Flex>

      {events.length === 0 ? (
        <Typography.Text type="secondary">No events recorded.</Typography.Text>
      ) : (
        <Timeline
          items={events.map((e) => ({
            // `content`, not `children`: antd 6 deprecated the latter on
            // Timeline items and dev-warns on every render.
            content: (
              <Flex vertical gap={2}>
                <Typography.Text strong>
                  {labelOf(UNIT_EVENT, e.type, t)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtDateTime(e.at)} · {e.staff}
                  {e.refCode ? ` · ${e.refCode}` : ""}
                </Typography.Text>
                {e.note && (
                  <Typography.Text style={{ fontSize: 12 }}>
                    {e.note}
                  </Typography.Text>
                )}
              </Flex>
            ),
          }))}
        />
      )}
    </Flex>
  );
}
