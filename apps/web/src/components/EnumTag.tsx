/**
 * One enum value, rendered as the `Tag` its map says it should be.
 *
 * The colour travels with the label because the two are one decision: green
 * means "in stock" and grey means "we do not recognise this", and a screen that
 * picks the label without the colour has only done half the job. Every status
 * column in the app goes through here, so there is nowhere left to render a
 * bare `TERSEDIA`.
 */
import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import { tagOf, type TagLabel } from "../i18n/enumLabels.js";

export function EnumTag({
  map,
  value,
}: {
  map: Record<string, TagLabel>;
  value: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { label, color } = tagOf(map, value, t);
  return <Tag color={color}>{label}</Tag>;
}
