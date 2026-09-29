import { useState } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm, Tooltip } from "antd";
import type { ButtonProps } from "antd";
import { useTranslation } from "react-i18next";
import { describeApiError } from "../i18n/apiErrors";

export interface DeleteActionProps {
  /** e.g. "Blue tea 500g" — goes into the button's `aria-label` AND the confirm text. */
  entityLabel: string;
  /** Set to render disabled with this reason in a `Tooltip`, instead of a Popconfirm. */
  blockedReason?: string;
  onConfirm: () => Promise<void>;
  size?: ButtonProps["size"];
}

/**
 * The one delete control every list and detail screen uses.
 *
 * `Tooltip` → `Popconfirm` (`okButtonProps={{danger:true}}`) → `Button`.
 * No `modal.confirm` anywhere in this app: a `Popconfirm` keeps the
 * destructive control visible-but-guarded right where it was clicked,
 * instead of interrupting with a full modal for what is usually a one-row
 * decision. `blockedReason` renders the SAME button disabled inside a plain
 * `Tooltip` (no confirm to guard, since the action cannot be taken) — that
 * is more discoverable than hiding the row's delete action entirely or
 * greying out a menu item with no explanation attached.
 */
export function DeleteAction({
  entityLabel,
  blockedReason,
  onConfirm,
  size,
}: DeleteActionProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [deleting, setDeleting] = useState(false);

  const button = (
    <Button
      type="text"
      danger
      size={size}
      icon={<DeleteOutlined />}
      loading={deleting}
      disabled={Boolean(blockedReason)}
      aria-label={t("deleteAction.aria", "Delete {{entity}}", {
        entity: entityLabel,
      })}
    />
  );

  if (blockedReason) {
    return <Tooltip title={blockedReason}>{button}</Tooltip>;
  }

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } catch (error) {
      message.error(describeApiError(error, t));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Tooltip
      title={t("deleteAction.tooltip", "Delete {{entity}}", {
        entity: entityLabel,
      })}
    >
      <Popconfirm
        title={t("deleteAction.confirmTitle", "Delete {{entity}}?", {
          entity: entityLabel,
        })}
        description={t("deleteAction.confirmDetail", "This cannot be undone.")}
        okText={t("common.delete", "Delete")}
        cancelText={t("common.cancel", "Cancel")}
        okButtonProps={{ danger: true, loading: deleting }}
        onConfirm={handleConfirm}
      >
        {button}
      </Popconfirm>
    </Tooltip>
  );
}
