/**
 * The store barcode for a serial, shown under the serial itself.
 *
 * ## What the owner asked for (2026-09-01)
 *
 * *"When generating barcode in Inbound QC, don't auto append the original with
 * store initial. Instead, still show whatever the S-10/12 digit in the serial
 * field 'SXXXX...', then below it show the store serial number 'Store QR:
 * XXSXXX...'"*
 *
 * So this is a READOUT, not a field and not a status. The serial box holds
 * Apple's barcode, which is what the database stores; this is the string the
 * shop's own sticker will carry, derived from it and the supplier's two-letter
 * origin code. Nothing here is editable, because nothing here is a fact
 * anybody types — it is the serial and the supplier, joined.
 *
 * ## When there is nothing to show
 *
 * Two cases, and they need different sentences. A supplier with no origin code
 * yet is a Settings job and the shop should be told so, because that machine
 * cannot be labelled until somebody does it. A serial that is not a valid
 * original barcode is older data — everything taken in before the rules
 * tightened — and its sticker will carry the bare serial, which still scans
 * back to the unit. Neither is drawn red: one is a task and the other is
 * history.
 */
import { Flex, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { isValidSerial, storeBarcodeOf } from "../lib/serialScan.js";
import { TYPE } from "../theme/tokens";

export function StoreLabelTag({
  serial,
  /** The origin code of whoever supplied this machine. */
  supplierCode,
}: {
  serial: string;
  supplierCode: string | undefined;
}) {
  const { t } = useTranslation();
  const store = storeBarcodeOf(serial, supplierCode);

  if (store !== null) {
    return (
      <Tooltip
        title={t(
          "serial.storeQrWhy",
          "What the shop's own sticker carries: the supplier's two-letter code in front of the machine's serial. Scanning either finds this unit.",
        )}
      >
        <Flex gap={4} align="baseline" style={{ fontSize: TYPE.sm }}>
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t("serial.storeQr", "Store QR:")}
          </Typography.Text>
          {/* Monospace and selectable — somebody checking a printed sticker
              against the screen is comparing character by character, and a
              proportional font makes that harder than it needs to be. */}
          <Typography.Text
            copyable={{ text: store }}
            style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
          >
            {store}
          </Typography.Text>
        </Flex>
      </Tooltip>
    );
  }

  const why = isValidSerial(serial)
    ? t(
        "serial.noStoreCodeWhy",
        "This supplier has no two-letter code yet, so no store barcode can be made. Settings → Suppliers is where to give it one.",
      )
    : t(
        "serial.badSerialWhy",
        "This serial is not an S followed by 10–12 characters, so no store barcode can be derived from it. Its sticker will carry the serial as it stands.",
      );

  return (
    <Tooltip title={why}>
      <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
        {t("serial.noStoreQr", "Store QR: —")}
      </Typography.Text>
    </Tooltip>
  );
}
