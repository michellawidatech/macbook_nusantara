/**
 * The scanner-ready indicator in the app header, plus the home for scans that
 * landed somewhere they could not be intercepted.
 *
 * Focus is the scanner's lifeline: the serial only types itself into the right
 * box if that box has focus, so when focus is lost this says so and makes
 * getting it back one click. On a page with no scan target it renders nothing
 * rather than a permanently greyed-out control.
 */
import { useEffect } from "react";
import { App, Button, Flex, Tooltip, Typography } from "antd";
import { BarcodeOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useLayoutMode } from "../layouts/useLayoutMode.js";
import { useScannerStatus } from "../hooks/useScanTarget.js";
import {
  deliverScan,
  focusScanTarget,
  subscribeScanMiss,
} from "../lib/scanner.js";
import { SPACE } from "../theme/tokens";

export function ScannerChip() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const status = useScannerStatus();
  const { compact } = useLayoutMode();

  // Every recognised scan ends somewhere the user can see. A scanner has no
  // screen of its own, so silence would leave them guessing whether the phone,
  // the bridge or the page was at fault.
  useEffect(
    () =>
      subscribeScanMiss(({ serial, reason }) => {
        const key = `miss-${serial}`;
        if (reason === "no-target") {
          message.open({
            key,
            type: "warning",
            duration: 6,
            content: t(
              "scanner.noSerialHere",
              "Scanned {{serial}} — this page has no serial field.",
              { serial },
            ),
          });
          return;
        }
        message.open({
          key,
          type: "info",
          duration: 8,
          content: (
            <span>
              {t("scanner.stray", "Scanned {{serial}} into another field.", {
                serial,
              })}{" "}
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                onClick={() => {
                  if (deliverScan(serial)) message.destroy(key);
                  else {
                    message.warning(
                      t("scanner.noTarget", "Nothing here takes a serial."),
                    );
                  }
                }}
              >
                {t("scanner.useIt", "Use it")}
              </Button>
            </span>
          ),
        });
      }),
    [message, t],
  );

  if (!status.enabled || !status.hasTarget) return null;

  const ready = status.armed;
  const label = ready
    ? t("scanner.ready", "Scanner ready")
    : t("scanner.lost", "Click to scan");
  const hint = ready
    ? t("scanner.readyHint", "Scan a barcode — it lands in the serial field.")
    : t(
        "scanner.lostHint",
        "Focus is in another field, so a scan would land there. Click to free it.",
      );

  return (
    <Tooltip title={hint}>
      <Button
        type="text"
        size="small"
        // A mouse affordance for a state the keyboard can fix by tabbing.
        tabIndex={-1}
        aria-label={`${label}. ${hint}`}
        onClick={() => {
          if (!focusScanTarget()) {
            message.warning(t("scanner.noField", "No serial field to focus."));
          }
        }}
      >
        <Flex align="center" gap={SPACE.xs}>
          <BarcodeOutlined />
          {!compact && (
            <Typography.Text type={ready ? "success" : "warning"}>
              {label}
            </Typography.Text>
          )}
        </Flex>
      </Button>
    </Tooltip>
  );
}
