/**
 * The grade as a tile on the left of a phone card (owner-approved mockup,
 * 2026-11-16 — "the same everywhere in the app"): New on the deep green, A
 * green, B amber, C red, and *pcs* for a counted product that has no grade.
 * The letter carries the meaning; the colour only repeats it.
 */
import { useTranslation } from "react-i18next";
import { gradeText, isNew } from "../lib/condition.js";
import { BRAND_DEEP, TYPE, WEIGHT } from "../theme/tokens";

const TONE: Record<string, { bg: string; fg: string }> = {
  A: { bg: "#dcf1e6", fg: "#065f46" },
  B: { bg: "#fff0c7", fg: "#6e4a00" },
  C: { bg: "#fde0dd", fg: "#9f2219" },
};

export function GradeTile({
  grade,
  counted = false,
  small = false,
}: {
  readonly grade: string | undefined | null;
  /** A counted product (no serial, no grade) reads "pcs". */
  readonly counted?: boolean;
  readonly small?: boolean;
}) {
  const { t } = useTranslation();
  const size = small ? 40 : 56;
  const text = counted
    ? t("gradeTile.pcs", "pcs")
    : (gradeText(grade, t("grade.new", "New")) ?? "–");
  const tone = counted
    ? { bg: "rgba(0,0,0,0.05)", fg: "rgba(0,0,0,0.55)" }
    : isNew(grade)
      ? { bg: BRAND_DEEP, fg: "#fff" }
      : (TONE[grade ?? ""] ?? { bg: "rgba(0,0,0,0.05)", fg: "inherit" });
  const letter = !counted && !isNew(grade) && text.length <= 2;
  return (
    <div
      aria-label={
        counted
          ? t("gradeTile.countedAria", "Counted product")
          : t("gradeTile.aria", "Grade {{grade}}", { grade: text })
      }
      style={{
        width: size,
        minHeight: size,
        height: "100%",
        borderRadius: 10,
        background: tone.bg,
        color: tone.fg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: WEIGHT.strong,
        fontSize: letter ? (small ? 18 : 24) : TYPE.md,
        lineHeight: 1.1,
      }}
    >
      <span aria-hidden>{text}</span>
      {letter && !small && (
        <span aria-hidden style={{ fontSize: 11, fontWeight: 500 }}>
          {t("gradeTile.grade", "Grade")}
        </span>
      )}
    </div>
  );
}
