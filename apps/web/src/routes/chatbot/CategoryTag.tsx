/**
 * What a waiting chat is waiting for, as a coloured tag with its words
 * (owner, 2026-11-16) — drawn on the thread list and under the waiting
 * message. Colour alone would say nothing to somebody who cannot tell
 * magenta from red, so the label is always there.
 */
import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import {
  categoryColor,
  categoryLabel,
  type ChatCategory,
} from "../../lib/chatCategory.js";

export function CategoryTag({
  category,
  title,
}: {
  category: ChatCategory;
  /** The finer topic, for a hover ("Warranty"). */
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <Tag
      color={categoryColor(category)}
      title={title}
      data-category={category}
      style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}
    >
      {categoryLabel(t, category)}
    </Tag>
  );
}
