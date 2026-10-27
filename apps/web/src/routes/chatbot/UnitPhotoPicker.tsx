/**
 * Choose which units' photos go to a customer (owner ask 2026-10-23).
 *
 * > *"Let the staff choose the unit name instead of serial, but they can also
 * > send multiple … they will search a product, the dialog box shows the
 * > serial options, and then they can choose, even multiple."*
 *
 * A product search, then that product's units on sale — grade, price and how
 * many photos — with a tick each. Ticks survive switching product, so units
 * of two products can go in one send. Only a unit the bot could send is
 * offered: on sale (`TERSEDIA`) and with at least one photo — the server
 * applies the same `unit_photos` rule and would refuse anything else.
 *
 * What goes out per unit is a line naming it, then its photos (at most three):
 * the server writes both (`POST /api/inbox/:phone/media`, `photoCaption`).
 */
import { useMemo, useState } from "react";
import { Flex, Modal, Select, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useDb } from "../../mock/store.js";
import { GradeTag } from "../../components/GradeTag";
import { fmtRp } from "../../lib/format.js";
import { priceOf } from "../../lib/unitPrice.js";
import { isLiveSku } from "../../lib/skuCode.js";
import { COLUMN, SPACE } from "../../theme/tokens";

/** How many units one send may carry — the server's `MAX_MEDIA_UNITS`. */
export const MAX_PICKED_UNITS = 5;

interface Row {
  readonly serial: string;
  readonly grade: string | undefined;
  readonly price: number;
  readonly photos: number;
}

export function UnitPhotoPicker({
  open,
  sending,
  onCancel,
  onSend,
}: {
  readonly open: boolean;
  readonly sending: boolean;
  readonly onCancel: () => void;
  readonly onSend: (serials: string[]) => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const [skuId, setSkuId] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string[]>([]);

  /** Photos per serial, the way the server counts them: every note's. */
  const photoCount = useMemo(() => {
    const out = new Map<string, number>();
    for (const n of db.unitNotes)
      out.set(n.serial, (out.get(n.serial) ?? 0) + n.photos.length);
    return out;
  }, [db.unitNotes]);

  /** Units the bot could send: on sale, with photos. */
  const sendable = useMemo(
    () =>
      db.units.filter(
        (u) => u.status === "TERSEDIA" && (photoCount.get(u.serial) ?? 0) > 0,
      ),
    [db.units, photoCount],
  );

  const products = useMemo(() => {
    const count = new Map<string, number>();
    for (const u of sendable) count.set(u.skuId, (count.get(u.skuId) ?? 0) + 1);
    return db.skus
      .filter((k) => isLiveSku(k) && count.has(k.id))
      .map((k) => ({
        value: k.id,
        label: `${k.name} ${k.variantLabel}`.trim(),
        count: count.get(k.id)!,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [db.skus, sendable]);

  const nameOf = (serial: string) => {
    const u = db.units.find((x) => x.serial === serial);
    const k = u && db.skus.find((s) => s.id === u.skuId);
    return k ? `${k.name} ${k.variantLabel}`.trim() : serial;
  };

  const rows: Row[] = useMemo(() => {
    const sku = db.skus.find((k) => k.id === skuId);
    return sendable
      .filter((u) => u.skuId === skuId)
      .map((u) => ({
        serial: u.serial,
        grade: u.grade,
        price: priceOf(u, sku?.price ?? 0),
        photos: Math.min(3, photoCount.get(u.serial) ?? 0),
      }))
      .sort((a, b) => a.serial.localeCompare(b.serial));
  }, [sendable, skuId, db.skus, photoCount]);

  const close = () => {
    setSkuId(undefined);
    setPicked([]);
    onCancel();
  };

  return (
    <Modal
      title={t("chat.pickPhotosTitle", "Send units' photos")}
      open={open}
      width={760}
      okText={t("chat.sendPickedPhotos", "Send photos of {{n}} unit(s)", {
        n: picked.length,
      })}
      okButtonProps={{ loading: sending, disabled: picked.length === 0 }}
      onOk={() => onSend(picked)}
      onCancel={close}
      afterClose={() => {
        setSkuId(undefined);
        setPicked([]);
      }}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.sm}>
        <Select<string>
          showSearch
          autoFocus
          allowClear
          optionFilterProp="label"
          style={{ width: "100%" }}
          value={skuId}
          onChange={setSkuId}
          aria-label={t("chat.pickProduct", "Product")}
          placeholder={t("chat.searchProduct", "Search a product")}
          notFoundContent={t(
            "chat.noPhotographedUnits",
            "No unit on sale has photos yet.",
          )}
          options={products.map((p) => ({
            value: p.value,
            label: p.label,
            title: p.label,
            count: p.count,
          }))}
          optionRender={(o) => (
            <Flex justify="space-between" gap={SPACE.sm}>
              <span>{o.label}</span>
              <Typography.Text type="secondary">
                {t("chat.unitsWithPhotos", "{{n}} unit(s)", {
                  n: (o.data as { count: number }).count,
                })}
              </Typography.Text>
            </Flex>
          )}
        />

        {skuId !== undefined && (
          <Table<Row>
            size="small"
            rowKey="serial"
            dataSource={rows}
            pagination={false}
            scroll={{ y: 320 }}
            rowSelection={{
              selectedRowKeys: picked.filter((s) =>
                rows.some((r) => r.serial === s),
              ),
              onChange: (keys) => {
                const here = new Set(rows.map((r) => r.serial));
                const others = picked.filter((s) => !here.has(s));
                setPicked(
                  [...others, ...(keys as string[])].slice(0, MAX_PICKED_UNITS),
                );
              },
              getCheckboxProps: (r) => ({
                disabled:
                  !picked.includes(r.serial) &&
                  picked.length >= MAX_PICKED_UNITS,
                "aria-label": r.serial,
              }),
            }}
            columns={[
              {
                title: t("chat.serial", "Serial"),
                dataIndex: "serial",
                width: COLUMN.serial,
              },
              {
                title: t("chat.grade", "Grade"),
                dataIndex: "grade",
                width: COLUMN.grade,
                render: (g: string | undefined) => <GradeTag grade={g} plain />,
              },
              {
                title: t("chat.price", "Price"),
                dataIndex: "price",
                align: "right",
                render: (v: number) => fmtRp(v),
              },
              {
                title: t("chat.photos", "Photos"),
                dataIndex: "photos",
                width: COLUMN.qty,
                align: "right",
              },
            ]}
          />
        )}

        {picked.length > 0 && (
          <Flex wrap gap={4}>
            {picked.map((s) => (
              <Tag
                key={s}
                closable
                onClose={() => setPicked((p) => p.filter((x) => x !== s))}
              >
                {nameOf(s)} · {s}
              </Tag>
            ))}
          </Flex>
        )}
        <Typography.Text type="secondary">
          {t(
            "chat.pickPhotosHint",
            "Each unit goes as a line naming it, then up to three of its photos. Up to {{max}} units at a time.",
            { max: MAX_PICKED_UNITS },
          )}
        </Typography.Text>
      </Flex>
    </Modal>
  );
}
