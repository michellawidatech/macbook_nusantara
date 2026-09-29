/**
 * The grading checklist itself — one dropdown per criterion of a category —
 * without a dialog around it.
 *
 * Lifted out of `GradingModal` on 2026-09-18, when the QC dialog on
 * `/inbound/:id` needed the same checklist folded open INSIDE it (owner ask:
 * *"When the user press the grade configuration it will expand the grade
 * configuration"*). One checklist in two frames, for the reason `GradingModal`
 * gives for existing at all: two copies are two rule tables, and the same
 * machine comes out a B at one desk and an A at the other.
 *
 * It only reports. The caller holds the answers (`selection`), and decides
 * what the calculated letter does — the return desk shows it beside an
 * override, the QC dialog writes it into its Grade box.
 */
import { useEffect, useRef } from "react";
import { Alert, Flex, Select, Typography } from "antd";
import type { RefSelectProps } from "antd";
import { useTranslation } from "react-i18next";
import { criteriaFor, type GradingSelection } from "../lib/grading.js";
import { useDb } from "../mock/store.js";
import { TYPE } from "../theme/tokens";

export interface GradingChecklistProps {
  /** Picks the checklist. Matches `CatalogModel.category`. */
  readonly category: string;
  /** What the inspector picked: criterion id → option id. */
  readonly selection: GradingSelection;
  readonly onChange: (next: GradingSelection) => void;
  /** Put the caret in the first question when the checklist appears. */
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
}

export function GradingChecklist({
  category,
  selection,
  onChange,
  autoFocus = false,
  disabled = false,
}: GradingChecklistProps) {
  const { t } = useTranslation();
  const db = useDb();
  const first = useRef<RefSelectProps>(null);
  const criteria = criteriaFor(db.gradingCriteria, category);

  useEffect(() => {
    if (autoFocus) first.current?.focus();
    // Once, when the checklist appears — not every time an answer changes.
  }, [autoFocus]);

  if (criteria.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        title={t(
          "grading.noConfig",
          "Nothing is configured for “{{category}}”",
          { category },
        )}
        description={t(
          "grading.noConfigBody",
          "Settings → Grading is where a category gets its checklist. Until then, pick the letter by hand below.",
        )}
      />
    );
  }

  return (
    <Flex vertical gap={10}>
      {criteria.map((c, i) => (
        <Flex key={c.id} vertical gap={4}>
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {c.name}
          </Typography.Text>
          <Select
            ref={i === 0 ? first : undefined}
            allowClear
            disabled={disabled}
            value={selection[c.id]}
            placeholder={t("grading.notChecked", "Not checked")}
            aria-label={c.name}
            options={c.options.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v?: string) => onChange({ ...selection, [c.id]: v })}
          />
        </Flex>
      ))}
    </Flex>
  );
}
