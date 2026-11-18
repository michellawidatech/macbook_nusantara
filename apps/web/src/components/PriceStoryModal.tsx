/**
 * Make a price list story — Export stock → Story image (owner ask
 * 2026-11-17). See `lib/priceStory.ts` for which units count and why.
 *
 * Two tabs and a preview. **Rows**: tick a variant off, type a "before"
 * price to strike through (empty means only the price now), switch NEW.
 * **Text**: every word on the picture, prefilled; a field never edited keeps
 * following its default, so next week's dates move by themselves. A photo of
 * the shop's own can replace the laptop.
 *
 * Everything staff set is kept on this device — the markup typed this week
 * is where next week starts — and nothing is sent anywhere: the picture is
 * drawn in the browser and handed over as PNG files, or to the phone's share
 * sheet where the browser can share files.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Collapse,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Spin,
  Switch,
  Table,
  Tabs,
  Typography,
  Upload,
} from "antd";
import {
  CloseOutlined,
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
  PictureOutlined,
  SaveOutlined,
  ShareAltOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { SHOP_PHONE } from "@nusantara/domain";
import { mutate, useDb } from "../mock/store.js";
import { useLayoutMode } from "../layouts/useLayoutMode";
import { draftKey, usePersistentState } from "../hooks/usePersistentState";
import { isRecord } from "../lib/draftGuards.js";
import type { StockExportFilter } from "../lib/stockExport.js";
import type { AppSettings } from "../mock/seed.js";
import {
  beforeIsLow,
  defaultStoryTexts,
  nowText,
  paginate,
  storyFileName,
  storyLines,
  storyStock,
  type StoryPrefs,
  type StoryRowPref,
  type StoryTexts,
} from "../lib/priceStory.js";
import {
  LIST,
  LIST_ROOM,
  STORY_H,
  STORY_W,
  cardHeight,
  layoutStory,
  type Measure,
} from "../lib/priceStoryLayout.js";
import {
  canvasMeasure,
  canvasPng,
  loadImage,
  loadStoryFont,
  loadStoryLaptop,
  loadStoryLogo,
  paintStory,
  type StoryAssets,
} from "../lib/priceStoryPaint.js";
import { MoneyInput } from "./MoneyInput.js";
import { SPACE, TYPE } from "../theme/tokens";

const TEXT_KEYS = [
  "promo",
  "titleTop",
  "titleBottom",
  "subtitle",
  "chips",
  "listTitle",
  "instagram",
  "whatsapp",
  "location",
] as const satisfies readonly (keyof StoryTexts)[];

type TextEdits = Partial<Record<keyof StoryTexts, string>>;

/** Where each word's shop-wide default is kept (`AppSetting` `story.*`). */
const SETTING_OF = {
  promo: "storyPromo",
  titleTop: "storyTitleTop",
  titleBottom: "storyTitleBottom",
  subtitle: "storySubtitle",
  chips: "storyChips",
  listTitle: "storyListTitle",
  instagram: "storyInstagram",
  whatsapp: "storyWhatsapp",
  location: "storyLocation",
} as const satisfies Record<(typeof TEXT_KEYS)[number], keyof AppSettings>;

/** Only string fields this build knows; anything else an older build wrote goes. */
function parseEdits(v: unknown): TextEdits | undefined {
  if (!isRecord(v)) return undefined;
  const out: TextEdits = {};
  for (const k of TEXT_KEYS) if (typeof v[k] === "string") out[k] = v[k];
  return out;
}

function parsePrefs(v: unknown): StoryPrefs | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, StoryRowPref> = {};
  for (const [id, p] of Object.entries(v)) {
    if (!isRecord(p)) continue;
    out[id] = {
      ...(typeof p["before"] === "number" && p["before"] > 0
        ? { before: p["before"] }
        : {}),
      ...(typeof p["isNew"] === "boolean" ? { isNew: p["isNew"] } : {}),
      ...(p["hidden"] === true ? { hidden: true } : {}),
    };
  }
  return out;
}

const parseHero = (v: unknown) =>
  typeof v === "string" && v.startsWith("data:image/") ? v : undefined;

/** A rough width for when no canvas can measure (tests, very old browsers). */
const roughMeasure: Measure = (text, size, weight) =>
  text.length * size * (weight >= 700 ? 0.6 : 0.55);

/** A chosen photo, shrunk to at most 1200px and kept as a JPEG data URL. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // PNG keeps a cut-out's transparency; a photo is smaller as JPEG.
    return file.type === "image/png"
      ? c.toDataURL("image/png")
      : c.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PriceStoryModal({
  open,
  onClose,
  filter,
}: {
  open: boolean;
  onClose: () => void;
  filter: StockExportFilter;
}) {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();

  const [edits, setEdits] = usePersistentState<TextEdits>(
    draftKey("priceStory.texts"),
    {},
    parseEdits,
  );
  const [prefs, setPrefs] = usePersistentState<StoryPrefs>(
    draftKey("priceStory.rows"),
    {},
    parsePrefs,
  );
  const [hero, setHero] = usePersistentState<string | undefined>(
    draftKey("priceStory.hero"),
    undefined,
    parseHero,
  );

  const defaults = useMemo(
    () => defaultStoryTexts(new Date(), { whatsapp: SHOP_PHONE }),
    [],
  );
  /*
   * Three layers (owner 2026-11-18: "can save as default so no need to always
   * edit the texts"): what this device typed, over the shop's saved default
   * (`AppSettings.story*`, every device sees it), over the built-in words.
   */
  const settings = db.settings;
  const shopDefault: TextEdits = {};
  for (const k of TEXT_KEYS) {
    const v = settings[SETTING_OF[k]];
    if (typeof v === "string" && v !== "") shopDefault[k] = v;
  }
  const texts: StoryTexts = { ...defaults, ...shopDefault, ...edits };

  /**
   * Save what is on screen as the default for every device. Only the words
   * that differ from the built-in ones are kept, so a promo period nobody
   * typed keeps moving with the calendar.
   */
  const saveDefault = () => {
    mutate((d) => {
      for (const k of TEXT_KEYS) {
        const v = texts[k] === defaults[k] ? undefined : texts[k];
        if (v === undefined) delete d.settings[SETTING_OF[k]];
        else d.settings[SETTING_OF[k]] = v;
      }
    });
    setEdits({});
    message.success(
      t(
        "priceStory.defaultSaved",
        "Saved — every device starts from these words.",
      ),
    );
  };
  const hasShopDefault = Object.keys(shopDefault).length > 0;

  const stock = useMemo(
    () => storyStock(db, filter),
    // `filter` is rebuilt by the parent each render; its three lists are what change.
    [
      db.units,
      db.skus,
      db.models,
      filter.warehouseIds,
      filter.categories,
      filter.modelIds,
    ],
  );
  const groups = useMemo(
    () => storyLines(stock.products, prefs),
    [stock.products, prefs],
  );
  const pages = useMemo(
    () => paginate(groups, LIST_ROOM, LIST.gap, cardHeight),
    [groups],
  );
  const [page, setPage] = useState(0);
  const shown = Math.min(page, Math.max(0, pages.length - 1));

  // The typeface, the logo and the photo, loaded once the dialog opens.
  const [assets, setAssets] = useState<StoryAssets | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      try {
        await loadStoryFont();
        const [logo, laptop] = await Promise.all([
          loadStoryLogo(),
          loadStoryLaptop(),
        ]);
        const photo = hero
          ? await loadImage(hero).catch(() => undefined)
          : undefined;
        if (live)
          setAssets({ logo, laptop, ...(photo ? { hero: photo } : {}) });
      } catch {
        // No logo means no picture; the dialog says so below.
        if (live) setAssets(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, hero]);

  const measure = useMemo<Measure>(() => {
    if (typeof document === "undefined") return roughMeasure;
    const ctx = document.createElement("canvas").getContext?.("2d");
    return ctx ? canvasMeasure(ctx) : roughMeasure;
    // Re-measured once the typeface is in: widths before it are the fallback's.
  }, [assets]);

  const opsOf = (i: number) =>
    layoutStory(pages[i] ?? [], texts, i + 1, pages.length, measure);

  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!open || !assets || !preview.current || pages.length === 0) return;
    paintStory(preview.current, opsOf(shown), assets);
  });

  /** Every page as a PNG, painted on a canvas of its own. */
  const files = async (): Promise<File[]> => {
    if (!assets) return [];
    const now = new Date();
    const out: File[] = [];
    for (let i = 0; i < pages.length; i += 1) {
      const c = document.createElement("canvas");
      paintStory(c, opsOf(i), assets);
      out.push(
        new File([await canvasPng(c)], storyFileName(now, i + 1), {
          type: "image/png",
        }),
      );
    }
    return out;
  };

  const hand = (f: File) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [busy, setBusy] = useState(false);
  const downloadAll = async () => {
    setBusy(true);
    try {
      const all = await files();
      all.forEach(hand);
      message.success(
        t("priceStory.downloaded", "{{n}} picture(s) downloaded.", {
          n: all.length,
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadPage = async () => {
    setBusy(true);
    try {
      const all = await files();
      const f = all[shown];
      if (f) hand(f);
    } finally {
      setBusy(false);
    }
  };
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof File !== "undefined" &&
    navigator.canShare({
      files: [new File([""], "x.png", { type: "image/png" })],
    });
  const share = async () => {
    setBusy(true);
    try {
      const all = await files();
      await navigator.share({ files: all });
    } catch {
      // Cancelled at the share sheet — nothing to say.
    } finally {
      setBusy(false);
    }
  };

  const setPref = (skuId: string, patch: Partial<StoryRowPref>) =>
    setPrefs((all) => {
      const next = { ...(all[skuId] ?? {}), ...patch };
      for (const k of Object.keys(next) as (keyof StoryRowPref)[])
        if (next[k] === undefined) delete next[k];
      return { ...all, [skuId]: next };
    });

  const setText = (k: keyof StoryTexts, v: string) =>
    setEdits((all) => ({ ...all, [k]: v }));

  const rows = stock.products.flatMap((p) =>
    p.rows.map((r) => ({ ...r, product: p.name })),
  );
  const empty = pages.length === 0;

  const labels: Record<(typeof TEXT_KEYS)[number], string> = {
    promo: t("priceStory.textPromo", "Promo label"),
    titleTop: t("priceStory.textTitleTop", "Headline, first line"),
    titleBottom: t("priceStory.textTitleBottom", "Headline, second line"),
    subtitle: t("priceStory.textSubtitle", "Subtitle"),
    chips: t("priceStory.textChips", "Tags (separate with commas)"),
    listTitle: t("priceStory.textListTitle", "Above the list"),
    instagram: t("priceStory.textInstagram", "Instagram"),
    whatsapp: t("priceStory.textWhatsapp", "WhatsApp"),
    location: t("priceStory.textLocation", "Location"),
  };

  const rowsTab = (
    <Flex vertical gap={SPACE.sm}>
      {stock.unpriced > 0 && (
        <Alert
          type="info"
          showIcon
          message={t(
            "priceStory.unpriced",
            "{{n}} unit(s) on sale have no sell price and are left off.",
            { n: stock.unpriced },
          )}
        />
      )}
      <Table
        size="small"
        rowKey="skuId"
        pagination={false}
        dataSource={rows}
        scroll={{ y: compact ? undefined : 520 }}
        locale={{
          emptyText: t(
            "priceStory.nothing",
            "No unit on sale with a sell price matches these filters.",
          ),
        }}
        columns={[
          {
            key: "on",
            width: 44,
            render: (_, r) => (
              <Checkbox
                aria-label={t("priceStory.include", "Show {{name}}", {
                  name: `${r.product} ${r.spec}`,
                })}
                checked={!prefs[r.skuId]?.hidden}
                onChange={(e) =>
                  setPref(r.skuId, {
                    hidden: e.target.checked ? undefined : true,
                  })
                }
              />
            ),
          },
          {
            key: "unit",
            title: t("priceStory.colUnit", "Unit"),
            render: (_, r) => (
              <Flex vertical>
                <Typography.Text strong>{r.product}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {r.spec || t("priceStory.noSpec", "One variant")} · {r.qty}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            key: "now",
            title: t("priceStory.colNow", "Price now"),
            width: 200,
            render: (_, r) => nowText(r),
          },
          {
            key: "before",
            title: t("priceStory.colBefore", "Before (struck through)"),
            width: 190,
            render: (_, r) => {
              const before = prefs[r.skuId]?.before;
              return (
                <Flex vertical gap={2}>
                  <MoneyInput
                    aria-label={t(
                      "priceStory.beforeOf",
                      "Before price of {{name}}",
                      {
                        name: `${r.product} ${r.spec}`,
                      },
                    )}
                    value={before}
                    placeholder={t("priceStory.beforeNone", "None")}
                    onChange={(v) =>
                      setPref(r.skuId, {
                        before: v !== null && v > 0 ? v : undefined,
                      })
                    }
                  />
                  {beforeIsLow(r, before) && (
                    <Typography.Text
                      type="warning"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {t("priceStory.beforeLow", "Not above the price now.")}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
          {
            key: "new",
            title: t("priceStory.colNew", "NEW"),
            width: 72,
            render: (_, r) => (
              <Switch
                size="small"
                aria-label={t("priceStory.newOf", "NEW tag on {{name}}", {
                  name: `${r.product} ${r.spec}`,
                })}
                checked={prefs[r.skuId]?.isNew ?? r.allNew}
                onChange={(on) =>
                  setPref(r.skuId, { isNew: on === r.allNew ? undefined : on })
                }
              />
            ),
          },
        ]}
      />
    </Flex>
  );

  const textTab = (
    <Form layout="vertical">
      {TEXT_KEYS.map((k) => (
        <Form.Item
          key={k}
          label={labels[k]}
          htmlFor={`price-story-${k}`}
          style={{ marginBottom: SPACE.sm }}
        >
          <Input
            id={`price-story-${k}`}
            value={texts[k]}
            onChange={(e) => setText(k, e.target.value)}
            maxLength={120}
          />
        </Form.Item>
      ))}
      <Form.Item label={t("priceStory.picture", "Picture")}>
        <Flex gap={SPACE.sm} wrap>
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              void shrinkPhoto(file)
                .then(setHero)
                .catch(() =>
                  message.error(
                    t(
                      "priceStory.pictureFailed",
                      "That picture could not be read.",
                    ),
                  ),
                );
              return false;
            }}
          >
            <Button icon={<PictureOutlined />}>
              {t("priceStory.pictureChange", "Use our own picture")}
            </Button>
          </Upload>
          {hero && (
            <Button onClick={() => setHero(undefined)}>
              {t("priceStory.pictureLaptop", "Back to the laptop")}
            </Button>
          )}
        </Flex>
      </Form.Item>
      <Flex gap={SPACE.sm} wrap>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          disabled={Object.keys(edits).length === 0}
          onClick={saveDefault}
        >
          {t("priceStory.saveDefault", "Save as default")}
        </Button>
        <Button
          icon={<UndoOutlined />}
          disabled={Object.keys(edits).length === 0}
          onClick={() => setEdits({})}
        >
          {hasShopDefault
            ? t("priceStory.backToDefault", "Back to the saved default")
            : t("priceStory.resetText", "Reset all text")}
        </Button>
        {hasShopDefault && (
          <Button
            onClick={() => {
              mutate((d) => {
                for (const k of TEXT_KEYS) delete d.settings[SETTING_OF[k]];
              });
              setEdits({});
            }}
          >
            {t("priceStory.clearDefault", "Use the original words")}
          </Button>
        )}
      </Flex>
    </Form>
  );

  const go = (i: number) => setPage(Math.max(0, Math.min(pages.length - 1, i)));
  // A swipe across the preview turns the page on a phone.
  const swipeFrom = useRef<number | null>(null);
  const previewBox = (
    <div
      onTouchStart={(e) => {
        swipeFrom.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = swipeFrom.current;
        swipeFrom.current = null;
        const to = e.changedTouches[0]?.clientX;
        if (from === null || to === undefined) return;
        if (to - from < -50) go(shown + 1);
        else if (to - from > 50) go(shown - 1);
      }}
      style={{ alignSelf: "center", width: compact ? "min(100%, 360px)" : 340 }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: `${STORY_W} / ${STORY_H}`,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
          display: "grid",
          placeItems: "center",
          background: "#f2f5f3",
        }}
      >
        {empty ? (
          <Typography.Text type="secondary" style={{ padding: SPACE.md }}>
            {t(
              "priceStory.nothing",
              "No unit on sale with a sell price matches these filters.",
            )}
          </Typography.Text>
        ) : assets ? (
          <canvas
            ref={preview}
            aria-label={t("priceStory.preview", "Preview of page {{n}}", {
              n: shown + 1,
            })}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <Spin />
        )}
      </div>
    </div>
  );

  /** The rows on the page shown, as cards a thumb can work (phone layout). */
  const rowById = new Map(rows.map((r) => [r.skuId, r]));
  const onPage = (pages[shown] ?? []).flatMap((g) =>
    g.rows.map((r) => ({ ...r, product: g.name })),
  );
  const removed = rows.filter((r) => prefs[r.skuId]?.hidden);
  const pageCards = (
    <Flex vertical gap={SPACE.sm}>
      {stock.unpriced > 0 && (
        <Alert
          type="info"
          showIcon
          message={t(
            "priceStory.unpriced",
            "{{n}} unit(s) on sale have no sell price and are left off.",
            { n: stock.unpriced },
          )}
        />
      )}
      {onPage.map((r) => {
        const name = `${r.product} ${r.spec}`;
        const before = prefs[r.skuId]?.before;
        return (
          <Card key={r.skuId} size="small">
            <Flex justify="space-between" align="flex-start" gap={SPACE.sm}>
              <Flex vertical style={{ minWidth: 0 }}>
                <Typography.Text strong>{r.product}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {r.spec || t("priceStory.noSpec", "One variant")} · {r.qty}
                </Typography.Text>
                <Typography.Text>{nowText(r)}</Typography.Text>
              </Flex>
              <Button
                danger
                icon={<CloseOutlined />}
                aria-label={t("priceStory.remove", "Remove {{name}}", { name })}
                onClick={() => setPref(r.skuId, { hidden: true })}
              />
            </Flex>
            <Flex gap={SPACE.sm} align="center" style={{ marginTop: SPACE.sm }}>
              <MoneyInput
                aria-label={t(
                  "priceStory.beforeOf",
                  "Before price of {{name}}",
                  {
                    name,
                  },
                )}
                value={before}
                placeholder={t(
                  "priceStory.colBefore",
                  "Before (struck through)",
                )}
                onChange={(v) =>
                  setPref(r.skuId, {
                    before: v !== null && v > 0 ? v : undefined,
                  })
                }
                style={{ flex: 1 }}
              />
              <Switch
                aria-label={t("priceStory.newOf", "NEW tag on {{name}}", {
                  name,
                })}
                checked={prefs[r.skuId]?.isNew ?? rowById.get(r.skuId)?.allNew}
                onChange={(on) =>
                  setPref(r.skuId, {
                    isNew: on === rowById.get(r.skuId)?.allNew ? undefined : on,
                  })
                }
                checkedChildren="NEW"
                unCheckedChildren="NEW"
              />
            </Flex>
            {beforeIsLow(r, before) && (
              <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
                {t("priceStory.beforeLow", "Not above the price now.")}
              </Typography.Text>
            )}
          </Card>
        );
      })}
      {removed.length > 0 && (
        <Collapse
          size="small"
          items={[
            {
              key: "removed",
              label: t("priceStory.removed", "Removed ({{n}})", {
                n: removed.length,
              }),
              children: (
                <Flex vertical gap={SPACE.xs}>
                  {removed.map((r) => (
                    <Flex
                      key={r.skuId}
                      justify="space-between"
                      align="center"
                      gap={SPACE.sm}
                    >
                      <Typography.Text style={{ minWidth: 0 }}>
                        {r.product} {r.spec}
                      </Typography.Text>
                      <Button
                        size="small"
                        onClick={() => setPref(r.skuId, { hidden: undefined })}
                      >
                        {t("priceStory.putBack", "Put back")}
                      </Button>
                    </Flex>
                  ))}
                </Flex>
              ),
            },
          ]}
        />
      )}
    </Flex>
  );
  const [phoneTab, setPhoneTab] = useState<"rows" | "text">("rows");

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t("priceStory.title", "Story image")}
      width={compact ? "100%" : 1180}
      style={{ maxWidth: "calc(100vw - 32px)" }}
      footer={
        <Flex justify="flex-end" gap={SPACE.sm} wrap>
          {canShare && (
            <Button
              icon={<ShareAltOutlined />}
              disabled={empty || !assets}
              loading={busy}
              onClick={() => void share()}
            >
              {t("priceStory.share", "Share")}
            </Button>
          )}
          {pages.length > 1 && (
            <Button
              icon={<DownloadOutlined />}
              disabled={!assets}
              loading={busy}
              onClick={() => void downloadPage()}
            >
              {t("priceStory.downloadPage", "Download this page")}
            </Button>
          )}
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            disabled={empty || !assets}
            loading={busy}
            onClick={() => void downloadAll()}
          >
            {pages.length > 1
              ? t("priceStory.downloadAll", "Download all ({{n}})", {
                  n: pages.length,
                })
              : t("priceStory.download", "Download")}
          </Button>
        </Flex>
      }
    >
      {compact ? (
        <Flex vertical gap={SPACE.md}>
          {pages.length > 1 && (
            <Flex justify="space-between" align="center">
              <Button
                icon={<LeftOutlined />}
                aria-label={t("priceStory.prevPage", "Previous page")}
                disabled={shown === 0}
                onClick={() => go(shown - 1)}
              />
              <Typography.Text strong>
                {t("priceStory.pageOf", "Page {{n}} of {{total}}", {
                  n: shown + 1,
                  total: pages.length,
                })}
              </Typography.Text>
              <Button
                icon={<RightOutlined />}
                aria-label={t("priceStory.nextPage", "Next page")}
                disabled={shown >= pages.length - 1}
                onClick={() => go(shown + 1)}
              />
            </Flex>
          )}
          {previewBox}
          <Segmented
            block
            value={phoneTab}
            onChange={(v) => setPhoneTab(v as "rows" | "text")}
            options={[
              {
                value: "rows",
                label: t("priceStory.tabPageRows", "Rows on this page"),
              },
              { value: "text", label: t("priceStory.tabText", "Text") },
            ]}
          />
          {phoneTab === "rows" ? pageCards : textTab}
        </Flex>
      ) : (
        <Flex gap={SPACE.lg} align="flex-start">
          <div style={{ flex: "1 1 520px", minWidth: 0 }}>
            <Tabs
              items={[
                {
                  key: "rows",
                  label: t("priceStory.tabRows", "Rows"),
                  children: rowsTab,
                },
                {
                  key: "text",
                  label: t("priceStory.tabText", "Text"),
                  children: textTab,
                },
              ]}
            />
          </div>
          <Flex
            vertical
            gap={SPACE.sm}
            align="center"
            style={{ flex: "0 0 auto" }}
          >
            {pages.length > 1 && (
              <Segmented
                value={shown}
                onChange={(v) => setPage(Number(v))}
                options={pages.map((_, i) => ({
                  value: i,
                  label: `${i + 1}`,
                }))}
              />
            )}
            {previewBox}
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("priceStory.size", "1080 × 1920 px — an Instagram story.")}
            </Typography.Text>
          </Flex>
        </Flex>
      )}
    </Modal>
  );
}
