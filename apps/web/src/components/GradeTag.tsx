/**
 * A machine's grade, wherever a serial is listed (owner ask 2026-08-28).
 *
 * *"For all table that displays serial, if it's new, the grade is new, however
 * if used, show the grade A/B."* — so the grade stopped being an inbound
 * detail and became a column of every list that names a machine: Inventory's
 * serial expansion, S/N tracking, the till's serial chooser, the QC grid and
 * the return desk.
 *
 * Six screens rendering `<Tag>{u.grade}</Tag>` themselves is six chances to
 * print the schema's shouting `NEW` beside a lower-case `A`, to pick a
 * different colour for the same letter, or to render an empty tag for a
 * machine nobody has inspected. This is the one place that decides, and
 * `lib/condition.ts` is where the meaning behind it is written down.
 *
 * An ungraded machine gets a muted dash rather than nothing at all: an empty
 * cell reads as a rendering fault, and "nobody has graded this" is a fact
 * worth showing in a shop where grading is the job.
 */
import { Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { GRADE_COLOR } from "../lib/grading.js";
import { gradeText, isNew } from "../lib/condition.js";

export function GradeTag({
  grade,
  /** Suppress the tooltip where the surrounding text already explains it. */
  plain = false,
}: {
  grade: string | undefined | null;
  plain?: boolean;
}) {
  const { t } = useTranslation();
  const text = gradeText(grade, t("grade.new", "New"));

  if (text === null) {
    return (
      <Typography.Text type="secondary">
        {t("grade.ungraded", "—")}
      </Typography.Text>
    );
  }

  const tag = (
    <Tag color={GRADE_COLOR[grade!]} style={{ marginInlineEnd: 0 }}>
      {text}
    </Tag>
  );
  if (plain) return tag;

  return (
    <Tooltip
      title={
        isNew(grade)
          ? t("grade.newHint", "Sealed — never used, so there is nothing to inspect")
          : t("grade.letterHint", "Condition grade from the QC checklist")
      }
    >
      {tag}
    </Tooltip>
  );
}
