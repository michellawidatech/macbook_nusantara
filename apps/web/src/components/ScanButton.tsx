/**
 * "Scan", in words, beside a serial box on a phone (owner-approved mockup,
 * 2026-11-16).
 *
 * A phone has no keyboard-wedge scanner wired to it as a laptop at the desk
 * does, so the button offers the two ways a phone CAN read a barcode:
 *
 * - **The camera**, where the browser has `BarcodeDetector` (Chrome on
 *   Android). What it reads is handed to the page exactly as a handheld's
 *   burst is — `deliverScan`, to whichever scan target the page registered —
 *   so every rule a scan obeys at that desk (the `S` marker, `I`/`O`, the
 *   till's straight-into-the-basket) applies unchanged.
 * - **A paired handheld** everywhere else (Safari on an iPhone has no
 *   `BarcodeDetector`): the button puts the caret in the scan box, where a
 *   Bluetooth scanner types, and says so.
 *
 * Drawn only on a phone; a desk's scanner needs no button.
 */
import { useEffect, useRef, useState } from "react";
import { App, Button, Modal, Typography } from "antd";
import { ScanOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { deliverScan, focusScanTarget } from "../lib/scanner.js";
import { useLayoutMode } from "../layouts/useLayoutMode";

interface DetectedBarcode {
  readonly rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorLike;

/** The browser's barcode reader, when it has one. */
export function barcodeDetector(): BarcodeDetectorCtor | undefined {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof ctor === "function" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined
    ? ctor
    : undefined;
}

export function ScanButton({
  onScan,
}: {
  /** Where a camera read goes; the page's scan target when omitted. */
  readonly onScan?: (serial: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [camera, setCamera] = useState(false);
  if (!compact) return null;

  const deliver = (raw: string) => {
    const serial = raw.trim().toUpperCase();
    if (serial === "") return;
    if (onScan) {
      onScan(serial);
      return;
    }
    if (!deliverScan(serial))
      message.warning(
        t("scan.nowhere", "Read {{serial}}, but nothing here takes a serial.", {
          serial,
        }),
      );
  };

  return (
    <>
      <Button
        icon={<ScanOutlined aria-hidden />}
        className="nusantara-scan-button"
        onClick={() => {
          if (barcodeDetector()) {
            setCamera(true);
            return;
          }
          focusScanTarget();
          message.info(t("scan.useHandheld", "Scan with the handheld now."));
        }}
        style={{ flexShrink: 0 }}
      >
        {t("scan.button", "Scan")}
      </Button>
      {camera && (
        <CameraScan
          onClose={() => setCamera(false)}
          onRead={(v) => {
            setCamera(false);
            deliver(v);
          }}
        />
      )}
    </>
  );
}

/** The viewfinder: the back camera, read a few times a second. */
function CameraScan({
  onClose,
  onRead,
}: {
  readonly onClose: () => void;
  readonly onRead: (value: string) => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const read = useRef(onRead);
  useEffect(() => {
    read.current = onRead;
  });

  useEffect(() => {
    const Ctor = barcodeDetector();
    if (!Ctor) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;
    const detector = new Ctor({
      formats: ["code_128", "qr_code", "code_39", "data_matrix", "ean_13"],
    });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (done) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        void v.play();
        timer = setInterval(() => {
          if (v.readyState < 2) return;
          detector
            .detect(v)
            .then((codes) => {
              const hit = codes.find((c) => c.rawValue.trim() !== "");
              if (hit && !done) {
                done = true;
                read.current(hit.rawValue);
              }
            })
            .catch(() => undefined);
        }, 250);
      })
      .catch(() => setFailed(true));
    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <Modal
      open
      title={t("scan.title", "Scan a barcode")}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      {failed ? (
        <Typography.Text type="danger">
          {t(
            "scan.noCamera",
            "The camera could not be opened. Allow it in the browser, or type the serial.",
          )}
        </Typography.Text>
      ) : (
        <video
          ref={video}
          muted
          playsInline
          style={{ width: "100%", borderRadius: 8, background: "#000" }}
        />
      )}
    </Modal>
  );
}
