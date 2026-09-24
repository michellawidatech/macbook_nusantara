/**
 * Correcting one unit's facts, from Inventory (owner ask 2026-09-23).
 *
 * > *"The action button should actually be price change and edit unit (edit
 * > serial, grade, battery, where, description, unit price)."*
 *
 * Six fields, and every one of them is something the bench can get wrong and
 * find out about later — a serial keyed from the wrong label, a battery read
 * off the machine beside it, a unit shelved on the wrong rack.
 *
 * ⚠️ Renaming carries the history with it: a unit is named by its serial
 * everywhere, so every `UnitEvent` moves too. `packages/db`'s events adapter
 * permits exactly that one edit — the denormalised serial, on rows that still
 * belong to the same unit — and refuses every other change to a ledger row.
 */
import { useEffect, useState } from "react";
import { App, Flex, Form, Input, Modal, Select } from "antd";
import { useTranslation } from "react-i18next";
import { BatteryFields } from "../../components/BatteryFields";
import { MoneyInput } from "../../components/MoneyInput";
import {
  batteryModeOfUnit,
  batteryDraftOf,
  type BatteryDraft,
} from "../../lib/battery.js";
import { NEW_GRADE } from "../../lib/condition.js";
import { readSerialInput, serialConditionOf } from "../../lib/serialInput.js";
import { appendEvent, mutate, useDb } from "../../mock/store.js";
import type { Unit } from "../../mock/seed.js";
import { FORM_CENTRE, SPACE } from "../../theme/tokens";

export interface UnitEditModalProps {
  readonly open: boolean;
  readonly unit: Unit | null;
  readonly onClose: () => void;
}

export function UnitEditModal({ open, unit, onClose }: UnitEditModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  const [serial, setSerial] = useState("");
  const [grade, setGrade] = useState<string | undefined>(undefined);
  const [battery, setBattery] = useState<BatteryDraft>({});
  const [locationId, setLocationId] = useState("");
  const [rackId, setRackId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [buy, setBuy] = useState<number>(0);

  useEffect(() => {
    if (!open || unit === null) return;
    setSerial(unit.serial);
    setGrade(unit.grade ?? undefined);
    setBattery(batteryDraftOf(unit));
    setLocationId(unit.locationId);
    setRackId(unit.rackId);
    setDescription(unit.description ?? "");
    setBuy(unit.buy ?? 0);
  }, [open, unit?.serial]);

  const mode =
    unit === null
      ? "HEALTH"
      : batteryModeOfUnit(unit, { skus: db.skus, models: db.models });

  const save = () => {
    if (unit === null) return;
    const next = serial.trim().toUpperCase();
    if (next === "") {
      message.error(t("unitEdit.serialRequired", "A unit needs a serial."));
      return;
    }
    if (next !== unit.serial && db.units.some((u) => u.serial === next)) {
      message.error(
        t("unitEdit.serialTaken", "{{serial}} belongs to another unit.", {
          serial: next,
        }),
      );
      return;
    }
    const where = locationId.trim();
    mutate((d) => {
      const u = d.units.find((x) => x.serial === unit.serial);
      if (!u) return;
      if (next !== u.serial) {
        // Everything that names a unit by its serial moves with it.
        for (const e of d.events) if (e.serial === u.serial) e.serial = next;
        for (const n of d.unitNotes) if (n.serial === u.serial) n.serial = next;
        for (const po of d.pos) {
          for (const item of po.items) {
            if (item.serial === u.serial) item.serial = next;
          }
        }
        u.serial = next;
      }
      u.grade = grade as Unit["grade"];
      u.batteryHealth = battery.health ?? undefined;
      u.cycleCount = battery.cycleCount ?? undefined;
      u.fcc = battery.fcc ?? undefined;
      u.description = description.trim();
      u.buy = buy;
      u.rackId = rackId;
      if (where !== "" && where !== u.locationId) {
        // A unit that moves shelf says so in its own timeline — the rule every
        // other move in this app follows.
        appendEvent(d, next, {
          type: "KOREKSI",
          toLocationId: where,
          note: t("unitEdit.movedNote", "Moved from Inventory"),
        });
      }
    });
    message.success(t("unitEdit.saved", "Unit updated."));
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={560}
      /*
       * Opened from the line's popup of units, which is a modal of its own in
       * another part of the tree — antd cannot stack the two for us, so
       * whichever portal mounted last would win. 1100 is where antd puts a
       * modal opened inside another (base 1000 plus its container offset).
       */
      zIndex={1100}
      title={t("unitEdit.title", "Edit unit")}
      okText={t("unitEdit.save", "Save")}
      onOk={save}
      destroyOnHidden
    >
      <Form layout="vertical" style={FORM_CENTRE}>
        <Form.Item label={t("unitEdit.serial", "Serial number")}>
          <Input
            value={serial}
            style={{ textTransform: "uppercase" }}
            onChange={(e) => setSerial(e.target.value)}
            onBlur={(e) => {
              // The same reading every other serial box takes: a typed bare
              // serial keeps its shape, a store barcode resolves to the unit
              // inside it (`lib/serialInput.ts`).
              const read = readSerialInput(e.target.value, {
                scanned: false,
                condition: serialConditionOf(grade),
              });
              if (read.ok) setSerial(read.serial);
            }}
          />
        </Form.Item>

        <Flex gap={SPACE.md} wrap>
          <Form.Item
            label={t("unitEdit.grade", "Grade")}
            style={{ flex: "1 1 160px" }}
          >
            <Select<string>
              allowClear
              value={grade}
              onChange={(v) => setGrade(v)}
              options={[
                { value: NEW_GRADE, label: t("unitEdit.gradeNew", "New") },
                { value: "A", label: "A" },
                { value: "B", label: "B" },
                { value: "C", label: "C" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label={t("unitEdit.battery", "Battery")}
            style={{ flex: "1 1 260px" }}
          >
            <BatteryFields
              fallback={mode}
              value={battery}
              onChange={setBattery}
              idPrefix={`unit-edit-${unit?.serial ?? ""}`}
            />
          </Form.Item>
        </Flex>

        <Flex gap={SPACE.md} wrap>
          <Form.Item
            label={t("unitEdit.warehouse", "Warehouse")}
            style={{ flex: "1 1 200px" }}
          >
            <Select<string>
              value={locationId}
              onChange={setLocationId}
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("unitEdit.rack", "Rack")}
            style={{ flex: "1 1 200px" }}
          >
            <Select<string | undefined>
              allowClear
              value={rackId}
              onChange={(v) => setRackId(v)}
              options={db.racks
                .filter((r) => r.warehouseId === locationId)
                .map((r) => ({ value: r.id, label: r.name }))}
            />
          </Form.Item>
        </Flex>

        <Form.Item label={t("unitEdit.description", "Description")}>
          <Input.TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Form.Item>

        <Form.Item label={t("unitEdit.unitPrice", "Unit price")}>
          <MoneyInput
            style={{ width: "100%" }}
            value={buy}
            onChange={(v) => setBuy(v ?? 0)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
