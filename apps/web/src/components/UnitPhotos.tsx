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
 * not ANNOUNCED until the server has it. A full-size phone photo used to say
 * "added" while it was still being sent, and a refresh in that window lost it
 * without a word.
 *
 * ## Nothing waits, nothing is missed (client report 2026-11-07)
 *
 * Of ten photos picked, nine were saved: the tenth was skipped here, and the
 * only word of it was a toast gone in four seconds. The bench photographs unit
 * after unit and must never be stopped, so nothing here is a dialog. Each
 * photo carries its own state on its tile — a spinner while it is read and
 * saved, a green tick once the server has it, and a RED tile with the file's
 * name when it did not go in, which stays until somebody retries or dismisses
 * it. The count beside the camera says "9 photos · 1 not added", and the
 * unit's row keeps a red count after this closes (`lib/photoIssues.ts`).
 *
 * ⚠️ These are the one thing in this codebase that is ever hard-deleted: they
 * are purged, row and file, when the machine is sold. `purgeQcPhotos` carries
 * the reasoning, and the rule stops there.
 */
import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Flex,
  Image,
  Popover,
  Spin,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CameraOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  ReloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { readPhoto } from "../lib/photoShrink.js";
import {
  addPhotoIssues,
  dropPhotoIssue,
  usePhotoIssues,
  type PhotoIssue,
  type PhotoIssueReason,
} from "../lib/photoIssues.js";
import {
  useDb,
  mutate,
  addQcPhoto,
  removeQcPhoto,
  qcPhotosOf,
} from "../mock/store.js";

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
   * Where a photo that did not go in is remembered (`lib/photoIssues.ts`).
   * The serial by default; a draft row passes its own, which is what its row
   * in the Units list reads.
   */
  issueKey?: string;
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

/** How long a saved photo keeps its green tick. */
const SAVED_TICK_MS = 3000;

export function UnitPhotos({
  serial = "",
  draft,
  issueKey,
  editable = false,
  size = 44,
  max = 3,
}: UnitPhotosProps) {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  /** Files being read (and a HEIC converted) — one spinning tile each. */
  const [reading, setReading] = useState<readonly string[]>([]);
  /** Photos on screen that the server has not confirmed yet, by url. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  /** Photos the server has just confirmed, by url — a tick for a moment. */
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const key = issueKey ?? serial;
  const issues = usePhotoIssues(key);
  const {
    token: {
      colorBorderSecondary,
      colorTextSecondary,
      colorError,
      colorErrorBg,
      colorErrorBorder,
      colorSuccess,
      colorBgMask,
      borderRadius,
    },
  } = theme.useToken();

  const photos = draft ? draft.photos : qcPhotosOf(db, serial);
  // A large photo row is a place somebody is working (the QC popup, the
  // serial history); a small one is a table cell, where the reasons fold
  // behind the red count.
  const roomy = size >= 64;

  // Ticks fade on their own; a timer per batch, cleared on unmount.
  useEffect(() => {
    if (saved.size === 0) return;
    const timer = setTimeout(() => setSaved(new Set()), SAVED_TICK_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  // Literal `t()` calls, one per reason: `test/i18n.test.ts` finds copy by
  // reading the source, and a key built from a variable is invisible to it.
  const reasonText = (reason: PhotoIssueReason): string => {
    switch (reason) {
      case "not-image":
        return t(
          "photos.notAnImage",
          "Not a photo — it is a video or another kind of file. Pick the photo itself.",
        );
      case "unreadable":
        return t(
          "photos.unreadable",
          "This photo's file could not be opened. Take it again, or save it as JPG and add it.",
        );
      case "too-big":
        return t(
          "photos.tooBig",
          "Larger than 6MB even after shrinking. Save it as JPG and add it again.",
        );
      case "not-saved":
        return t("photos.notSaved", "It could not be saved. Press retry.");
    }
  };

  /** Save photos already read onto the unit; true when the server has them. */
  const save = async (
    items: readonly { name: string; url: string }[],
  ): Promise<void> => {
    const urls = items.map((i) => i.url);
    setSaving((s) => new Set([...s, ...urls]));
    const ok = await mutate((d) => {
      for (const url of urls) addQcPhoto(d, serial, url);
    });
    setSaving((s) => new Set([...s].filter((u) => !urls.includes(u))));
    if (!ok) {
      // The store has said why and taken them off screen; the tiles stay, red,
      // with a retry, because the photos are still in hand.
      addPhotoIssues(
        key,
        items.map((i) => ({ name: i.name, reason: "not-saved", url: i.url })),
      );
      return;
    }
    setSaved((s) => new Set([...s, ...urls]));
    message.success(
      t("photos.added", "{{count}} photo(s) added to {{serial}}.", {
        count: urls.length,
        serial,
      }),
    );
  };

  const choose = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const names = picked.map((f) => f.name);
    setReading((r) => [...r, ...names]);
    // Every file is read before anything is written, so one `mutate` covers a
    // multi-select. Writing per file would clone the whole database once per
    // picture and re-render the QC grid between each.
    const ready: { name: string; url: string }[] = [];
    const refused: Omit<PhotoIssue, "id">[] = [];
    for (const file of picked) {
      const read = await readPhoto(file);
      if (read.ok) ready.push({ name: file.name, url: read.url });
      else refused.push({ name: file.name, reason: read.problem });
    }
    setReading((r) => {
      const left = [...r];
      for (const n of names) left.splice(left.indexOf(n), 1);
      return left;
    });
    addPhotoIssues(key, refused);
    if (ready.length === 0) return;
    if (draft) {
      draft.onAdd(ready.map((r) => r.url));
      setSaved((s) => new Set([...s, ...ready.map((r) => r.url)]));
      message.success(
        t("photos.addedDraft", "{{count}} photo(s) added.", {
          count: ready.length,
        }),
      );
      return;
    }
    await save(ready);
  };

  const retry = (issue: PhotoIssue) => {
    if (issue.url === undefined) return;
    dropPhotoIssue(key, issue.id);
    if (draft) {
      draft.onAdd([issue.url]);
      return;
    }
    void save([{ name: issue.name, url: issue.url }]);
  };

  const drop = async (photoId: string) => {
    if (draft) draft.onRemove(photoId);
    else if (!(await mutate((d) => removeQcPhoto(d, serial, photoId)))) return;
    message.success(t("photos.removed", "Photo removed."));
  };

  const shown = photos.slice(0, max);
  const hidden = photos.length - shown.length;

  const tileStyle = {
    width: size,
    height: size,
    borderRadius,
    flex: "none" as const,
  };

  /** What is over a thumbnail: nothing, a spinner, or a tick. */
  const overlay = (url: string) =>
    saving.has(url) ? (
      <span
        aria-label={t("photos.saving", "Saving…")}
        style={{
          ...tileStyle,
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: colorBgMask,
        }}
      >
        <Spin size="small" />
      </span>
    ) : saved.has(url) ? (
      <CheckCircleFilled
        aria-label={t("photos.savedTick", "Saved")}
        style={{
          position: "absolute",
          bottom: 4,
          insetInlineStart: 4,
          color: colorSuccess,
          fontSize: Math.max(12, Math.round(size / 4)),
          background: "var(--nusantara-surface, #fff)",
          borderRadius: "50%",
        }}
      />
    ) : null;

  const issueLine = (issue: PhotoIssue) => (
    <Flex
      key={issue.id}
      gap={6}
      align="start"
      data-testid="photo-issue"
      style={{ maxWidth: 420 }}
    >
      <ExclamationCircleFilled
        style={{ color: colorError, marginTop: 3 }}
        aria-hidden
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong style={{ wordBreak: "break-all" }}>
          {issue.name}
        </Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {reasonText(issue.reason)}
        </Typography.Text>
      </span>
      {issue.reason === "not-saved" && (
        <Button
          size="small"
          icon={<ReloadOutlined />}
          aria-label={t("photos.retry", "Retry {{name}}", { name: issue.name })}
          onClick={() => retry(issue)}
        />
      )}
      <Button
        size="small"
        type="text"
        icon={<CloseOutlined />}
        aria-label={t("photos.dismiss", "Dismiss {{name}}", {
          name: issue.name,
        })}
        onClick={() => dropPhotoIssue(key, issue.id)}
      />
    </Flex>
  );

  const notAdded =
    issues.length > 0 ? (
      <Typography.Text
        style={{ fontSize: 12, color: colorError, cursor: "pointer" }}
        data-testid="photo-not-added"
      >
        {t("photos.notAddedCount", "{{count}} not added", {
          count: issues.length,
        })}
      </Typography.Text>
    ) : null;

  const row = (
    // Room for each thumbnail's delete, which sits over its top-right corner:
    // at 6px a large thumbnail's bin landed on the next photo.
    <Flex gap={roomy ? 12 : 6} align="center" wrap>
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
              {overlay(p.url)}
              {editable && !saving.has(p.url) && (
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

      {/* A tile per file still being read — a HEIC takes a second or two to
          convert — so a pick of ten shows ten things happening at once. */}
      {reading.map((name, i) => (
        <span
          key={`reading-${i}-${name}`}
          aria-label={t("photos.reading", "Reading {{name}}", { name })}
          style={{
            ...tileStyle,
            display: "grid",
            placeItems: "center",
            border: `1px dashed ${colorBorderSecondary}`,
          }}
        >
          <Spin size="small" />
        </span>
      ))}

      {/* A red tile per photo that did not go in, its reason listed below. In
          a table cell there is no room for tiles: the red count beside the
          camera opens the same list. */}
      {roomy &&
        issues.map((issue) => (
          <Tooltip
            key={issue.id}
            title={`${issue.name} — ${reasonText(issue.reason)}`}
          >
            <span
              aria-label={t("photos.notAddedTile", "{{name}} was not added", {
                name: issue.name,
              })}
              style={{
                ...tileStyle,
                display: "grid",
                placeItems: "center",
                background: colorErrorBg,
                border: `1px solid ${colorErrorBorder}`,
                color: colorError,
                fontSize: Math.max(14, Math.round(size / 3)),
              }}
            >
              <ExclamationCircleFilled aria-hidden />
            </span>
          </Tooltip>
        ))}

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
           *
           * Never disabled while a pick is being read or saved: the next pick
           * is the bench's business, and each tile says how its own is going.
           */}
          {photos.length === 0 ? (
            <Button
              size="small"
              icon={<CameraOutlined />}
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
                onClick={() => input.current?.click()}
                aria-label={t("photos.add", "Add photo")}
              />
            </Tooltip>
          )}
        </>
      )}

      {/* The count the bench glances at: "9 photos · 1 not added". */}
      {roomy && (photos.length > 0 || issues.length > 0) && (
        <Typography.Text
          style={{ fontSize: 12, color: colorTextSecondary }}
          data-testid="photo-count"
        >
          {t("photos.count", "{{count}} photo(s)", { count: photos.length })}
          {issues.length > 0 && (
            <>
              {" · "}
              {notAdded}
            </>
          )}
        </Typography.Text>
      )}
      {!roomy && notAdded && (
        <Popover
          trigger="click"
          content={
            <Flex vertical gap={8}>
              {issues.map(issueLine)}
            </Flex>
          }
        >
          {notAdded}
        </Popover>
      )}

      {!editable && photos.length === 0 && issues.length === 0 && (
        <Typography.Text style={{ color: colorTextSecondary }}>
          {t("photos.none", "No photo")}
        </Typography.Text>
      )}
    </Flex>
  );

  if (!roomy || issues.length === 0) return row;
  return (
    <Flex vertical gap={10}>
      {row}
      <Flex vertical gap={8}>
        {issues.map(issueLine)}
      </Flex>
    </Flex>
  );
}
