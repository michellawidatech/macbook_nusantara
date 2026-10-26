/**
 * A count beside a nav label (2026-10-26) — so far, the units waiting for QC
 * on Inbound & QC.
 *
 * Its own component so that only IT subscribes to the store: the menu around
 * it is built once per language and staff, and a nav that re-rendered on
 * every till's commit to update one number would be paying for the whole
 * column. `qcWaitingCount` skips the event ledger for the same reason.
 *
 * Nothing at zero (antd's Badge draws no count for 0), so a caught-up bench
 * leaves the label as it always was.
 */
import { useMemo } from "react";
import { Badge } from "antd";
import { useTranslation } from "react-i18next";
import { useDb } from "../mock/store.js";
import { qcWaitingCount } from "../lib/qcWaiting.js";
import { NAV } from "../theme/tokens";
import type { NavBadgeKind } from "./navigation.js";

export function NavBadge({ kind }: { readonly kind: NavBadgeKind }) {
  const { t } = useTranslation();
  const db = useDb();
  const count = useMemo(
    () => (kind === "qcWaiting" ? qcWaitingCount(db) : 0),
    [db, kind],
  );
  if (count === 0) return null;
  const label = t("nav.qcWaiting", "{{count}} unit(s) waiting for QC", {
    count,
  });
  return (
    <Badge
      count={count}
      overflowCount={99}
      size="small"
      title={label}
      aria-label={label}
      data-nav-badge={kind}
      style={{
        marginInlineStart: 8,
        backgroundColor: NAV.badgeBg,
        color: NAV.badgeText,
        boxShadow: "none",
        fontWeight: 600,
      }}
    />
  );
}
