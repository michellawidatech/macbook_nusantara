/**
 * The photographs of one machine — taken at QC, read everywhere afterwards.
 *
 * A second-hand shop's whole argument with a customer six weeks later is about
 * condition, and a sentence in the Description field is one person's word for
 * it. The owner asked for a picture per serial at QC (2026-08-26) and for the
 * same pictures to be visible while counting stock, so this is one component
 * with two modes rather than two components that will drift.
 *
 * ## Where the picture lives
 *
 * On a `UnitNote` tagged `QC`, not on the unit — that is the schema's shape
 * (`UnitNotePhoto` → `UnitNote` → `Unit`) and it is the right one: a photo of
 * a dent and the sentence about the dent are one observation. `mock/store.ts`
 * holds the three functions that read and write it.
 *
 * ## Why a data URL
 *
 * There is no object store in the browser build, so a chosen file is read into
 * a data URL and kept in the mock database exactly where a real `url` would
 * go. Nothing that displays a photo can tell the difference, so swapping in an
 * upload endpoint is a change to `addQcPhoto` and to nothing here.
 *
 * ⚠️ These are the one thing in this codebase that is ever hard-deleted: they
 * are purged, row and file, when the machine is sold. `purgeQcPhotos` carries
 * the reasoning, and the rule stops there.
 */
import { useRef, useState } from "react";
import { App, Button, Flex, Image, Tooltip, Typography, theme } from "antd";
import { CameraOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  useDb,
  mutate,
  addQcPhoto,
  removeQcPhoto,
  qcPhotosOf,
} from "../mock/store.js";

/**
 * The largest file a phone camera should be able to hand us, in bytes.
 *
 * A data URL is held in memory and cloned on every `mutate`, so an 8MP JPEG
 * straight off a phone is a real cost rather than a theoretical one. Six
 * megabytes is comfortably above any photo of a laptop lid and below the size
 * at which the store starts to hurt.
 */
const MAX_BYTES = 6 * 1024 * 1024;

export interface UnitPhotosProps {
  serial: string;
  /**
   * Show the add and remove controls. Off where the pictures are evidence
   * being read rather than evidence being gathered — a posted stock count, a
   * unit that has left QC.
   */
  editable?: boolean;
  /** Thumbnail edge, in pixels. Table cells want small ones. */
  size?: number;
  /** How many thumbnails to draw before summarising the rest as "+N". */
  max?: number;
}

export function UnitPhotos({
  serial,
  editable = false,
  size = 44,
  max = 3,
}: UnitPhotosProps) {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const {
    token: { colorBorderSecondary, colorTextSecondary, borderRadius },
  } = theme.useToken();

  const photos = qcPhotosOf(db, serial);

  const choose = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    // Every file is read before anything is written, so one `mutate` covers a
    // multi-select. Writing per file would clone the whole database once per
    // picture and re-render the QC grid between each.
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        message.error(
          t("photos.notAnImage", "{{name}} is not an image.", {
            name: file.name,
          }),
        );
        continue;
      }
      if (file.size > MAX_BYTES) {
        message.error(
          t("photos.tooBig", "{{name}} is too large — 6MB is the limit.", {
            name: file.name,
          }),
        );
        continue;
      }
      urls.push(
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
      );
    }
    setBusy(false);
    // Toasts and writes only once the reads are done — never inside a state
    // updater, and never inside `mutate`.
    if (urls.length === 0) return;
    mutate((d) => {
      for (const url of urls) addQcPhoto(d, serial, url);
    });
    message.success(
      t("photos.added", "{{count}} photo(s) added to {{serial}}.", {
        count: urls.length,
        serial,
      }),
    );
  };

  const drop = (photoId: string) => {
    mutate((d) => removeQcPhoto(d, serial, photoId));
    message.success(t("photos.removed", "Photo removed."));
  };

  const shown = photos.slice(0, max);
  const hidden = photos.length - shown.length;

  return (
    <Flex gap={6} align="center" wrap>
      {/* One PreviewGroup per serial: clicking any thumbnail opens the
          lightbox on that picture and the arrows walk this machine's other
          photos, not every photo on the page.
          
          Skipped entirely when there is nothing to preview. That is not
          micro-optimisation: this component renders once per row of the QC
          grid, most rows have no photograph yet, and an empty PreviewGroup
          per row is a context provider and a portal host bought for nothing.
          It measurably slowed the grid down. */}
      {photos.length > 0 && (
        <Image.PreviewGroup>
          {shown.map((p) => (
            <div key={p.id} style={{ position: "relative", lineHeight: 0 }}>
              <Image
                src={p.url}
                width={size}
                height={size}
                alt={t("photos.alt", "Photo of {{serial}}", { serial })}
                style={{
                  objectFit: "cover",
                  borderRadius,
                  border: `1px solid ${colorBorderSecondary}`,
                }}
              />
              {editable && (
                <Tooltip title={t("photos.remove", "Remove this photo")}>
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t("photos.remove", "Remove this photo")}
                    onClick={() => drop(p.id)}
                    style={{
                      position: "absolute",
                      top: -6,
                      insetInlineEnd: -6,
                      // The delete sits ON the thumbnail, so it needs its own
                      // ground to be legible over a photograph of anything.
                      background: "var(--nusantara-surface, #fff)",
                      borderRadius: "50%",
                      minWidth: 18,
                      width: 18,
                      height: 18,
                      padding: 0,
                      fontSize: 10,
                      lineHeight: 1,
                    }}
                  />
                </Tooltip>
              )}
            </div>
          ))}
          {/* The overflow thumbnails are still in the group — hidden from the
            grid but reachable from the lightbox's arrows, which is what makes
            "+2" a promise the preview can keep. */}
          {photos.slice(max).map((p) => (
            <Image key={p.id} src={p.url} style={{ display: "none" }} />
          ))}
        </Image.PreviewGroup>
      )}

      {hidden > 0 && (
        <Typography.Text
          style={{ fontSize: 12, color: colorTextSecondary }}
          aria-label={t("photos.more", "{{count}} more", { count: hidden })}
        >
          +{hidden}
        </Typography.Text>
      )}

      {editable && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            // `capture` is deliberately absent: on a phone this leaves the
            // OS sheet offering BOTH the camera and the gallery, and half of
            // these pictures were taken before anyone reached this screen.
            hidden
            onChange={(e) => {
              void choose(e.target.files);
              // Cleared so choosing the same file twice fires `change` twice —
              // otherwise a photo deleted by mistake cannot be re-added.
              e.target.value = "";
            }}
          />
          {/*
           * No tooltip when the button already says what it does. A tooltip
           * over a labelled button repeats the label, and this control renders
           * once per row of the QC grid — every wrapper here is paid as many
           * times as there are machines on the order.
           */}
          {photos.length === 0 ? (
            <Button
              size="small"
              icon={<CameraOutlined />}
              loading={busy}
              onClick={() => input.current?.click()}
            >
              {t("photos.add", "Add photo")}
            </Button>
          ) : (
            <Tooltip
              title={t(
                "photos.addHint",
                "Photograph the condition of {{serial}}",
                { serial },
              )}
            >
              <Button
                size="small"
                icon={<CameraOutlined />}
                loading={busy}
                onClick={() => input.current?.click()}
                aria-label={t("photos.add", "Add photo")}
              />
            </Tooltip>
          )}
        </>
      )}

      {!editable && photos.length === 0 && (
        <Typography.Text style={{ color: colorTextSecondary }}>
          {t("photos.none", "No photo")}
        </Typography.Text>
      )}
    </Flex>
  );
}
