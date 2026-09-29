/**
 * Scanner settings, and the panel that makes tuning them evidence-based.
 *
 * A barcode scanner — the phone through "Barcode to PC", or the handheld —
 * is a keyboard that types very fast and presses Enter. Telling that apart
 * from a hand means picking a threshold, and the right threshold depends on
 * hardware nobody can inspect from here: `robotjs` typing through the phone
 * bridge is slower and far more variable than a handheld unit.
 *
 * So rather than shipping a number and hoping, this shows what the last scan
 * actually did. The reading that matters is `rawGaps`: a single spike in a row
 * of small numbers is what splits one barcode into two short ones, and it is
 * invisible in every other view.
 */
import { useState } from "react";
import {
  Alert,
  Card,
  Flex,
  Form,
  InputNumber,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useScanTarget, useScannerStatus } from "../../hooks/useScanTarget.js";
import {
  getScannerSettings,
  setScannerSettings,
  type ScannerSettings as Settings,
} from "../../lib/scanner.js";
import { readBarcode } from "../../lib/serialScan.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import { useDb } from "../../mock/store.js";
import { FORM_CENTRE } from "../../theme/tokens";
import { useTranslation } from "react-i18next";

export function ScannerSettings() {
  const { t } = useTranslation();
  const db = useDb();
  const [settings, setLocal] = useState<Settings>(getScannerSettings);
  const status = useScannerStatus();

  // Registering a target is what makes this page a place you can scan at all:
  // without one, a scan with focus outside the test box has nowhere to go and
  // the panel would stay empty. The reading itself comes from `lastScan`.
  useScanTarget(() => undefined);

  const patch = (p: Partial<Settings>) => {
    setScannerSettings(p);
    setLocal(getScannerSettings());
  };

  const last = status.lastScan;
  const slowest = last && last.gaps.length > 0 ? Math.max(...last.gaps) : null;
  const broke = last?.rawGaps.filter((g) => g >= settings.burstGapMs) ?? [];

  /** Whether the last scan was one of Apple's serial barcodes. */
  const read = last ? readBarcode(last.serial) : null;
  const shape = read?.ok ? read : null;
  /**
   * The unit this read names, if the shop holds one.
   *
   * Through `resolveSerialQuery` rather than a bare lookup, because that is
   * what the sales floor does with a scan and this panel is meant to tell
   * somebody what their scanner will actually achieve out there — a scan of
   * Apple's barcode finds the unit, and the answer should say so.
   */
  const resolved = last
    ? resolveSerialQuery(
        last.serial,
        db.units.map((u) => u.serial),
      )
    : "";
  const matched = db.units.some((u) => u.serial === resolved) ? resolved : null;

  return (
    <Flex vertical gap={16}>
      <Card title={t("scanner.barcodeScanner", "Barcode scanner")}>
        <Alert
          type="info"
          showIcon
          title={t(
            "scanner.noSetupNeededOnThis",
            "No setup needed on this device.",
          )}
          description={t(
            "scanner.aScannerIsAKeyboard",
            "A scanner is a keyboard. Both the Barcode to PC phone bridge and the handheld scanner type the serial and press Enter, so scans are picked up wherever you are in the app — there is no connection to configure.",
          )}
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical" style={{ ...FORM_CENTRE, maxWidth: 460 }}>
          <Form.Item
            label={t("scanner.acceptScans", "Accept scans")}
            tooltip={t(
              "scanner.turnOffToTypeSerials",
              "Turn off to type serials by hand without the scanner claiming keystrokes.",
            )}
          >
            <Switch
              checked={settings.enabled}
              onChange={(v) => patch({ enabled: v })}
            />
          </Form.Item>
          <Form.Item
            label={t(
              "scanner.fastestAHandCanType",
              "Fastest a hand can type (ms between characters)",
            )}
            tooltip={t(
              "scanner.charactersArrivingCloserTogetherThan",
              "Characters arriving closer together than this are treated as a scan. Lower is stricter. Raise it if scans come out short.",
            )}
          >
            <InputNumber
              min={5}
              max={500}
              step={5}
              value={settings.burstGapMs}
              disabled={!settings.enabled}
              onChange={(v) => v && patch({ burstGapMs: v })}
            />
          </Form.Item>
          <Form.Item
            label={t(
              "scanner.shortestRunThatCountsAs",
              "Shortest run that counts as a barcode (characters)",
            )}
            tooltip={t(
              "scanner.aFastRunShorterThan",
              "A fast run shorter than this is treated as quick typing, not a scan.",
            )}
          >
            <InputNumber
              min={2}
              max={20}
              value={settings.minChars}
              disabled={!settings.enabled}
              onChange={(v) => v && patch({ minChars: v })}
            />
          </Form.Item>
          <Form.Item
            label={t(
              "scanner.silenceThatMeansTheScan",
              "Silence that means the scan has finished (ms)",
            )}
            tooltip={t(
              "scanner.someScannersSendNoEnter",
              "Some scanners send no Enter. After this much quiet, the serial is committed anyway.",
            )}
          >
            <InputNumber
              min={10}
              max={1000}
              step={10}
              value={settings.settleMs}
              disabled={!settings.enabled}
              onChange={(v) => v && patch({ settleMs: v })}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card title={t("scanner.testAScan", "Test a scan")}>
        <Typography.Paragraph type="secondary">
          Scan a barcode anywhere on this page — you do not need to click into
          anything first. Then check the character count against the label: if
          it is short, one of the gaps below went over the threshold and split
          the scan.
        </Typography.Paragraph>

        {last === null ? (
          <Typography.Text type="secondary">
            {t("scanner.nothingScannedYet", "Nothing scanned yet.")}
          </Typography.Text>
        ) : (
          <Flex vertical gap={12}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <Typography.Text code>{last.serial}</Typography.Text>{" "}
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                {last.serial.length} characters
              </Typography.Text>
            </Typography.Title>

            {/*
             * Whether that was a serial barcode, and whether the shop holds
             * the unit (owner asks 2026-09-01 and 2026-09-21). This panel is
             * where somebody goes to find out what their scanner is actually
             * sending, so it answers both — and files nothing.
             */}
            <Flex gap={8} wrap align="center">
              {shape === null ? (
                <Tag color="gold">
                  {t("scanner.notASerialBarcode", "Not a serial barcode")}
                </Tag>
              ) : (
                <>
                  <Tag color="blue">
                    {t("scanner.serialBarcode", "Serial barcode")}
                  </Tag>
                  <Typography.Text type="secondary">
                    {t("scanner.originalBarcodeRead", "Serial {{serial}}", {
                      serial: shape.serial,
                    })}
                  </Typography.Text>
                </>
              )}
              {matched ? (
                <Tag color="green">
                  {t("scanner.inStockAs", "In stock as {{serial}}", {
                    serial: matched,
                  })}
                </Tag>
              ) : (
                <Tag>
                  {t("scanner.notInStock", "No unit with this serial yet")}
                </Tag>
              )}
            </Flex>
            {shape === null && (
              <Typography.Text type="secondary">
                {t(
                  "scanner.notASerialBarcodeWhy",
                  "A serial barcode is S plus 10–12 characters. A new unit is taken in only from one; a second-hand unit's barcode is taken as read.",
                )}
              </Typography.Text>
            )}

            {broke.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                title={`${broke.length} gap(s) went over ${settings.burstGapMs} ms and split this scan.`}
                description={`The slowest was ${Math.max(...broke)} ms. If the serial above is shorter than the one on the label, raise the threshold past that.`}
              />
            ) : (
              <Alert
                type="success"
                showIcon
                title={
                  slowest === null
                    ? "Captured in one burst."
                    : `Captured in one burst — slowest gap ${slowest} ms, threshold ${settings.burstGapMs} ms.`
                }
              />
            )}

            <div>
              <Typography.Text type="secondary">
                {t(
                  "scanner.gapBetweenEachCharacterIn",
                  "Gap between each character, in order:",
                )}
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                {last.rawGaps.map((g, i) => (
                  <Tag
                    key={i}
                    color={g >= settings.burstGapMs ? "error" : "default"}
                  >
                    {g}
                  </Tag>
                ))}
              </div>
            </div>
          </Flex>
        )}
      </Card>
    </Flex>
  );
}
