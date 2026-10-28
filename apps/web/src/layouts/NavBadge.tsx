/**
 * A count beside a nav label (2026-10-26) — the units waiting for QC on
 * Inbound & QC, and the bot's reservation requests waiting on a person
 * (2026-10-27).
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
import { pendingRequestCount } from "../lib/reservationRequests.js";
import { useChatWaiting } from "../hooks/useChatWaiting.js";
import { NAV } from "../theme/tokens";
import type { NavBadgeKind } from "./navigation.js";

export function NavBadge({ kind }: { readonly kind: NavBadgeKind }) {
  return kind === "chatWaiting" ? <ChatBadge /> : <StoreBadge kind={kind} />;
}

/** Chats waiting for a person — from the server, not the store (2026-10-28). */
function ChatBadge() {
  const { t } = useTranslation();
  const { count } = useChatWaiting();
  if (count === 0) return null;
  return (
    <Count
      kind="chatWaiting"
      count={count}
      label={t("chatWaiting.label", "{{count}} chat(s) need a reply", {
        count,
      })}
    />
  );
}

function StoreBadge({
  kind,
}: {
  readonly kind: "qcWaiting" | "reservationRequests";
}) {
  const { t } = useTranslation();
  const db = useDb();
  const count = useMemo(
    () =>
      kind === "qcWaiting"
        ? qcWaitingCount(db)
        : pendingRequestCount(db, new Date()),
    [db, kind],
  );
  if (count === 0) return null;
  const label =
    kind === "qcWaiting"
      ? t("nav.qcWaiting", "{{count}} unit(s) waiting for QC", { count })
      : t(
          "nav.reservationRequests",
          "{{count}} reservation request(s) waiting",
          { count },
        );
  return <Count kind={kind} count={count} label={label} />;
}

function Count({
  kind,
  count,
  label,
}: {
  readonly kind: NavBadgeKind;
  readonly count: number;
  readonly label: string;
}) {
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
