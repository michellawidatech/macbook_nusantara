/**
 * The inspection behind a grade — one dialog, two desks.
 *
 * It was written inline on `/inbound/:id` for the owner's grading ask
 * (2026-08-27) and lifted out here on 2026-08-28, when the return desk needed
 * the same conversation: *"If a new unit is bought then returned, it will be
 * second, thus need grading and description when receiving the unit back."*
 *
 * Lifting it rather than writing a second one is the whole point. A grade is a
 * claim about a machine that outlives the screen it was made on, and two
 * dialogs would be two rule tables, two override lists and two ways of saying
 * what a C means — which is how the same machine comes to be a B at intake and
 * an A at the counter.
 *
 * What each desk keeps for itself is the CONSEQUENCE. Intake can send a C back
 * to the supplier or onto the bench; the return desk can do neither, because
 * the machine is already the shop's. So the C warning takes its actions from
 * the caller, and the dialog itself only ever concludes a letter.
 *
 * One dropdown per criterion of the machine's CATEGORY — Settings → Grading
 * owns the checklist — and the letter falls out of the rule table as the
 * conditions are picked. Overridable, because a rule table cannot see the
 * machine.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Flex, Modal, Select, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  GRADES,
  GRADE_COLOR,
  computeGrade,
  criteriaFor,
  describeSelection,
  type GradingSelection,
} from "../lib/grading.js";
import { useDb } from "../mock/store.js";

export function GradingModal({
  open,
  onClose,
  category,
  subject,
  currentGrade,
  onApply,
  initialSelection,
  initialOverride,
  cActions,
}: {
  open: boolean;
  onClose: () => void;
  /** Picks the checklist. Matches `CatalogModel.category`. */
  category: string;
  /** The line of context above the checklist — product, serial. */
  subject: ReactNode;
  /** What the machine is graded as now, named so the change is visible. */
  currentGrade?: string;
  /**
   * `inspection` is the checklist said in words, for the ledger note;
   * `selection` is the checklist itself, so a caller that wants to reopen the
   * dialog on the same answers can keep it. See `initialSelection`.
   */
  onApply: (
    grade: string,
    inspection: string,
    selection: GradingSelection,
  ) => void;
  /**
   * The answers to reopen with (owner ask 2026-09-01).
   *
   * *"Now when I grade & I finish and I want to edit, it literally resets the
   * grading, but I need it to tell me what is the last state grading."*
   *
   * The note this replaces argued that a stored LETTER is a conclusion with no
   * honest checklist behind it, and that is still true — which is why this is
   * a prop rather than something derived from `currentGrade`. A caller that
   * has kept the actual selection passes it back and the dialog reopens where
   * it was left; a caller that has only a letter passes nothing and gets the
   * old blank-checklist behaviour, because it has nothing truthful to show.
   */
  initialSelection?: GradingSelection;
  /** The letter that was chosen over the calculated one, if one was. */
  initialOverride?: string;
  /**
   * Extra buttons on the grade-C warning. The argument applies the grade and
   * closes, so a caller can chain its own consequence onto it — intake uses
   * that to grade and then reject in one gesture.
   */
  cActions?: (applyThenClose: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const db = useDb();
  /** What the inspector picked: criterion id → option id. */
  const [selection, setSelection] = useState<GradingSelection>({});
  /** A letter chosen over the calculated one. */
  const [override, setOverride] = useState<string>();

  /**
   * The checklist reopens on the answers it was left with, when the caller
   * kept them (owner ask 2026-09-01) — and blank when it did not.
   *
   * Both halves matter. Reopening blank was the complaint: somebody who has
   * graded a machine and wants to change one line should not have to answer
   * six questions again. But prefilling from a stored LETTER would be worse
   * than blank, because a letter is a conclusion and the answers that produced
   * it were never written down — the dialog would be showing somebody a
   * checklist nobody filled in. So the caller supplies the answers or nothing.
   *
   * Keyed on `open` alone, deliberately: re-running when `initialSelection`
   * changes identity would reset the dialog under the hand of somebody
   * answering it, because most callers build that object inline.
   */
  useEffect(() => {
    if (open) {
      setSelection(initialSelection ?? {});
      setOverride(initialOverride);
    }
    // `initialSelection` is deliberately not a dependency — see above. This
    // project's eslint config has no exhaustive-deps rule to disable, so the
    // reason is stated rather than suppressed.
  }, [open]);

  const criteria = criteriaFor(db.gradingCriteria, category);
  const computed = computeGrade(db.gradingRules, category, selection);
  const final = override ?? computed ?? undefined;

  const finish = () => {
    if (final) {
      onApply(
        final,
        describeSelection(db.gradingCriteria, category, selection),
        selection,
      );
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("grading.title", "Grade this machine")}
      footer={null}
      width={560}
      onCancel={onClose}
      // Fields are reset by the effect above rather than by unmounting, so
      // the dialog keeps its scroll position when a caller reopens it on the
      // next machine in a pile.
      destroyOnHidden={false}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          {subject}
          {currentGrade &&
            ` · ${t("grading.currently", "currently {{grade}}", {
              grade: currentGrade,
            })}`}
        </Typography.Text>

        {criteria.length === 0 ? (
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
        ) : (
          <Flex vertical gap={10}>
            {criteria.map((c) => (
              <Flex key={c.id} vertical gap={4}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.name}
                </Typography.Text>
                <Select
                  allowClear
                  value={selection[c.id]}
                  placeholder={t("grading.notChecked", "Not checked")}
                  aria-label={c.name}
                  options={c.options.map((o) => ({
                    value: o.id,
                    label: o.label,
                  }))}
                  onChange={(v?: string) =>
                    setSelection((sel) => ({ ...sel, [c.id]: v }))
                  }
                />
              </Flex>
            ))}
          </Flex>
        )}

        <Flex align="flex-end" gap={16} wrap>
          {criteria.length > 0 && (
            <Flex vertical gap={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("grading.calculated", "Calculated")}
              </Typography.Text>
              {computed ? (
                <Tag
                  color={GRADE_COLOR[computed]}
                  style={{ fontSize: 16, padding: "2px 12px" }}
                >
                  {computed}
                </Tag>
              ) : (
                <Typography.Text type="secondary">
                  {t("grading.noneYet", "answer the checklist, or pick one")}
                </Typography.Text>
              )}
            </Flex>
          )}
          <Flex vertical gap={4} style={{ width: 200 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("grading.override", "Overwrite")}
            </Typography.Text>
            <Select
              allowClear
              value={override}
              placeholder={t("grading.useCalculated", "Use the calculated grade")}
              aria-label={t("grading.override", "Overwrite")}
              options={GRADES.map((g) => ({ value: g, label: g }))}
              onChange={(v?: string) => setOverride(v)}
            />
          </Flex>
        </Flex>

        {final === "C" && (
          <Alert
            type="warning"
            showIcon
            title={t("grading.cTitle", "Grade C — worth a second thought")}
            description={t(
              "grading.cBody",
              "A machine this worn is often better returned to the supplier or sent to the bench than put on the shelf.",
            )}
            action={cActions?.(finish)}
          />
        )}

        <Flex justify="flex-end" gap={8}>
          <Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button type="primary" disabled={!final} onClick={finish}>
            {final
              ? t("grading.applyN", "Apply grade {{grade}}", { grade: final })
              : t("grading.apply", "Apply grade")}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
