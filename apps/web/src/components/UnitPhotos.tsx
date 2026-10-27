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
 * A chosen file is shrunk (`lib/photoShrink.ts`) and read into a data URL,
 * which the store commit carries; the server keeps the bytes and answers with
 * a `/api/store/photos/:id` url in its place.
 *
 * ## Added means saved (client report 2026-10-21)
 *
 * The photo is drawn the moment it is picked, like every change, but it is
 * not ANNOUNCED until the server has it — the button spins until then. A
 * full-size phone photo used to say "added" while it was still being sent,
 * and a refresh in that window lost it without a word.
 *
 * ⚠️ These are the one thing in this codebase that is ever hard-deleted: they
 * are purged, row and file, when the machine is sold. `purgeQcPhotos` carries
 * the reasoning, and the rule stops there.
 */
import { useRef, useState } from "react";
import { App, Button, Flex, Image, Tooltip, Typography, theme } from "antd";
import { CameraOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { shrinkPhoto } from "../lib/photoShrink.js";
import {
  useDb,
  mutate,
  addQcPhoto,
  removeQcPhoto,
  qcPhotosOf,
} from "../mock/store.js";

/**
 * The largest photo kept, in bytes — measured AFTER shrinking, so it bites
 * only on a file the browser could not decode and shrink (HEIC on a desktop
 * browser). The server refuses anything over 8MB.
 */
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Photos taken of a unit whose serial is not known yet (owner revision
 * 2026-09-19: nothing on Inbound & QC waits for the serial). The caller holds
 * them and writes them onto the unit, with `addQcPhoto`, in the mutation that
 * mints it.
 */
export interface DraftPhotos {
  readonly photos: readonly { readonly id: string; readonly url: string }[];
  readonly onAdd: (urls: string[]) => void;
  readonly onRemove: (id: string) => void;
}

export interface UnitPhotosProps {
  /** The unit, once it exists. Ignored while `draft` is given. */
  serial?: string;
  /** Photos held for a unit that has no serial yet. */
  draft?: DraftPhotos;
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
  serial = "",
  draft,
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

  const photos = draft ? draft.photos : qcPhotosOf(db, serial);

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
      const photo = await shrinkPhoto(file);
      if (photo.bytes > MAX_BYTES) {
        message.error(
          t("photos.tooBig", "{{name}} is too large — 6MB is the limit.", {
            name: file.name,
          }),
        );
        continue;
      }
      urls.push(photo.url);
    }
    // Toasts and writes only once the reads are done — never inside a state
    // updater, and never inside `mutate`.
    if (urls.length === 0) {
      setBusy(false);
      return;
    }
    if (draft) {
      setBusy(false);
      draft.onAdd(urls);
      message.success(
        t("photos.addedDraft", "{{count}} photo(s) added.", {
          count: urls.length,
        }),
      );
      return;
    }
    const saved = await mutate((d) => {
      for (const url of urls) addQcPhoto(d, serial, url);
    });
    setBusy(false);
    // A refusal has already been said, by the store, and taken off screen.
    if (!saved) return;
    message.success(
      t("photos.added", "{{count}} photo(s) added to {{serial}}.", {
        count: urls.length,
        serial,
      }),
    );
  };

  const drop = async (photoId: string) => {
    if (draft) draft.onRemove(photoId);
    else if (!(await mutate((d) => removeQcPhoto(d, serial, photoId)))) return;
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
                alt={
                  serial
                    ? t("photos.alt", "Photo of {{serial}}", { serial })
                    : t("photos.altDraft", "Photo of this unit")
                }
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
                    onClick={() => void drop(p.id)}
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
            // And `display: none` as well: inside an antd `Form`, antd's own
            // `input[type='file'] { display: block }` outranks the `hidden`
            // attribute, and a bare "Choose Files" appeared in the QC dialog.
            style={{ display: "none" }}
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
              title={
                serial
                  ? t(
                      "photos.addHint",
                      "Photograph the condition of {{serial}}",
                      { serial },
                    )
                  : t(
                      "photos.addHintDraft",
                      "Photograph the condition of this unit",
                    )
              }
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
