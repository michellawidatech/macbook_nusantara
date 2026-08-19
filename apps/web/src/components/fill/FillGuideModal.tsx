import { useEffect, useRef, useState } from "react";
import {
  Button,
  Carousel,
  Flex,
  Input,
  Modal,
  Space,
  Typography,
  theme,
} from "antd";
import type { CarouselRef } from "antd/es/carousel";
import { useTranslation } from "react-i18next";
import { SPACE } from "../../theme/tokens";

/** One mock cell in a slide's illustration. */
interface GuideCell {
  value?: string;
  selected?: boolean;
}

interface GuideSlide {
  /** Printed on the keyboard, so not translated — `Ctrl`, `⌘`, `Esc`. */
  keys: string[];
  title: string;
  body: string;
  /** Rows of cells, top to bottom. Ragged rows are fine. */
  grid: GuideCell[][];
}

/**
 * How tall a slide's content is held, so the arrows and dots do not move as
 * the carousel advances between illustrations of different heights.
 */
const SLIDE_MIN_HEIGHT = 300;

/** Roughly a real cell's width, narrow enough for two columns side by side. */
const CELL_WIDTH = 96;

/**
 * A cell of the illustration, painted exactly as `MultiFillNumber` paints a
 * real one — same outline, same background, same radius, read from the same
 * tokens. A guide whose selected cell looks different from the selected cell
 * on the screen behind it is teaching the wrong thing.
 */
function IllustrationCell({ value, selected }: GuideCell) {
  const {
    token: { colorPrimary, colorPrimaryBg, borderRadius },
  } = theme.useToken();

  return (
    <Flex
      style={{
        padding: 2,
        borderRadius: borderRadius + 2,
        outline: selected
          ? `2px solid ${colorPrimary}`
          : "2px solid transparent",
        background: selected ? colorPrimaryBg : undefined,
      }}
    >
      <Input
        readOnly
        // Out of the tab order and out of the accessibility tree: this is a
        // picture of an input, and the caption below it is what carries the
        // meaning. Tabbing through nine fake cells to reach Done is not a
        // guide, it is an obstacle.
        tabIndex={-1}
        value={value ?? ""}
        style={{ width: CELL_WIDTH }}
      />
    </Flex>
  );
}

function Illustration({ grid }: { grid: GuideCell[][] }) {
  return (
    <Flex vertical gap={SPACE.xs} align="center" aria-hidden>
      {grid.map((row, rowIndex) => (
        <Flex key={rowIndex} gap={SPACE.xs}>
          {row.map((cell, cellIndex) => (
            <IllustrationCell key={cellIndex} {...cell} />
          ))}
        </Flex>
      ))}
    </Flex>
  );
}

export interface FillGuideModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The illustrated version of what the fill hint says in one line.
 *
 * Multi-cell fill is worth a great deal to whoever knows it is there and
 * nothing at all to whoever does not, and the gesture is not one an operator
 * discovers by clicking around — nobody Ctrl-clicks a form field to see what
 * happens. It used to be explained by a four-sentence `Alert` above the table,
 * which is the shape of text people skip. So: one short line, and a `?` beside
 * it for the seven gestures shown one at a time.
 *
 * Every key `MultiFillNumber` handles has a slide, and one that it deliberately
 * does NOT: bare ↑/↓ belong to the number box's own stepper, which is worth
 * saying out loud because the modified arrows sit right beside them.
 *
 * Shared by the product variant table and the stock-in receipt lines, which
 * run the same engine (`useCellSelection`, `MultiFillNumber`) and therefore
 * must not describe it in two voices.
 */
export function FillGuideModal({ open, onClose }: FillGuideModalProps) {
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary },
  } = theme.useToken();

  const carousel = useRef<CarouselRef>(null);
  const [index, setIndex] = useState(0);

  // Back to the first slide every time the guide opens, in BOTH halves: the
  // footer's own count, and the carousel itself.
  //
  // `destroyOnHidden` is supposed to make the second half unnecessary — a
  // carousel thrown away on close remounts at slide 0 — but it only destroys
  // once the leave animation ends. Close on the last slide and reopen before
  // that lands and the surviving carousel still shows slide 7 under a footer
  // that has reset to "1 of 7". `goTo` is a no-op when the ref is null, which
  // is exactly the case where the remount already did the job. Keyed on `open`
  // rather than done in `afterClose` for the same reason: that fires from a
  // transition, and this must not depend on one.
  useEffect(() => {
    if (open) {
      setIndex(0);
      carousel.current?.goTo(0, true);
    }
  }, [open]);

  const slides: GuideSlide[] = [
    {
      keys: ["Ctrl", "⌘", "+ Click"],
      title: t("fill.guide.select.title", "Pick out any cells"),
      body: t(
        "fill.guide.select.body",
        "Hold Ctrl (⌘ on a Mac) and click to add a cell to the selection. They do not have to share a column. Type once and every selected cell takes the value.",
      ),
      grid: [
        [{ value: "200", selected: true }, {}],
        [{}, { value: "200", selected: true }],
        [{ value: "200", selected: true }, {}],
      ],
    },
    {
      keys: ["Shift", "+ Click"],
      title: t("fill.guide.range.title", "Or a whole block at once"),
      body: t(
        "fill.guide.range.body",
        "Click one cell, then Shift-click another. Everything between the two corners is selected — across columns as well as down rows.",
      ),
      grid: [
        [
          { value: "200", selected: true },
          { value: "200", selected: true },
        ],
        [
          { value: "200", selected: true },
          { value: "200", selected: true },
        ],
        [
          { value: "200", selected: true },
          { value: "200", selected: true },
        ],
      ],
    },
    {
      keys: ["Enter"],
      title: t("fill.guide.enter.title", "Enter moves down"),
      body: t(
        "fill.guide.enter.body",
        "Enter drops to the next row and highlights what is already there, so the next number replaces it. On the last row it adds a new one and lands in it.",
      ),
      grid: [[{ value: "200" }], [{ selected: true }], [{}]],
    },
    {
      keys: ["Shift", "+ Enter"],
      title: t("fill.guide.enterUp.title", "Shift-Enter moves back up"),
      body: t(
        "fill.guide.enterUp.body",
        "The same walk in reverse, for the row you have just gone past. It stops at the top row rather than wrapping, and never adds one.",
      ),
      grid: [[{}], [{ selected: true }], [{ value: "200" }]],
    },
    {
      keys: ["Alt", "⌘", "+ ↑ ↓"],
      title: t("fill.guide.arrows.title", "Or hold Alt and use the arrows"),
      body: t(
        "fill.guide.arrows.body",
        "Hold Alt (⌥ or ⌘ on a Mac) with ↑ or ↓ to move exactly as Enter does. The arrows on their own belong to the number box, which steps the value up and down in place.",
      ),
      grid: [[{ value: "200" }], [{ selected: true }], [{ value: "200" }]],
    },
    {
      keys: ["Tab", "Shift + Tab"],
      title: t("fill.guide.tab.title", "Tab crosses the row"),
      body: t(
        "fill.guide.tab.body",
        "Tab moves to the next field along the row and Shift-Tab back, carrying on into the row below. Whatever was selected collapses to the cell you land on, so Tab is also the gentle way out of a selection.",
      ),
      grid: [[{ value: "200" }, { selected: true }]],
    },
    {
      keys: ["Esc"],
      title: t("fill.guide.escape.title", "Esc clears the selection"),
      body: t(
        "fill.guide.escape.body",
        "Esc drops both the selection and the caret. An ordinary click does the same thing more gently — it collapses the selection back to the one cell you clicked.",
      ),
      grid: [
        [{ value: "200" }, { value: "200" }],
        [{ value: "200" }, { value: "200" }],
      ],
    },
  ];

  return (
    <Modal
      open={open}
      title={t("fill.guide.title", "Filling many cells at once")}
      onCancel={onClose}
      // Ordinary buttons, because the Carousel's own controls are invisible
      // here. antd draws its arrows as a white chevron at `opacity: 0.4` and
      // its dots as `colorBgContainer` at `opacity: 0.2` — both hard-coded, not
      // tokens, because a carousel is meant to sit over a photograph. Against a
      // modal's own surface that is white-on-white in light mode and a grey
      // smudge in dark, so the guide read as a single slide with no way
      // forward: nobody ever saw past Ctrl-click. `Back`/`Next` also give the
      // sequence real focus targets and a spoken label, which a chevron drawn
      // in a `::after` border never had.
      footer={
        <Flex justify="space-between" align="center">
          <Typography.Text style={{ color: colorTextSecondary }}>
            {t("fill.guide.progress", "{{current}} of {{total}}", {
              current: index + 1,
              total: slides.length,
            })}
          </Typography.Text>
          <Space size={SPACE.xs}>
            <Button
              disabled={index === 0}
              onClick={() => carousel.current?.prev()}
            >
              {t("common.back", "Back")}
            </Button>
            {index === slides.length - 1 ? (
              <Button type="primary" onClick={onClose}>
                {t("common.done", "Done")}
              </Button>
            ) : (
              <Button type="primary" onClick={() => carousel.current?.next()}>
                {t("common.next", "Next")}
              </Button>
            )}
          </Space>
        </Flex>
      }
      destroyOnHidden
      width={520}
    >
      <Carousel
        ref={carousel}
        // The built-in arrows and dots are off — see the footer above, which
        // replaces both.
        arrows={false}
        dots={false}
        // `beforeChange`, not `afterChange`: the latter is fired from a
        // `setTimeout(speed)` inside react-slick, so the counter and the
        // Back/Next pair stayed a whole slide behind — reaching the last slide
        // still offering "Next". This fires as the move commits, which is also
        // when the buttons should catch up.
        beforeChange={(_current, next) => setIndex(next)}
        // Stops at both ends rather than wrapping: the slides read as a
        // sequence, and `infinite` also clones every child, which would put
        // two copies of each illustration in the DOM for no gain here.
        infinite={false}
        draggable
      >
        {slides.map((slide) => (
          <div key={slide.title}>
            <Flex
              vertical
              align="center"
              justify="center"
              gap={SPACE.md}
              style={{
                minHeight: SLIDE_MIN_HEIGHT,
                // A reading measure for the body text — it used to be here to
                // clear the carousel's own arrows, which are now off.
                paddingInline: SPACE.xl,
                paddingBlock: SPACE.md,
              }}
            >
              <Illustration grid={slide.grid} />
              <Space size={SPACE.xs} wrap>
                {slide.keys.map((key) => (
                  <Typography.Text keyboard key={key}>
                    {key}
                  </Typography.Text>
                ))}
              </Space>
              <Flex vertical align="center" gap={SPACE.xs}>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {slide.title}
                </Typography.Title>
                <Typography.Paragraph
                  style={{
                    margin: 0,
                    textAlign: "center",
                    color: colorTextSecondary,
                  }}
                >
                  {slide.body}
                </Typography.Paragraph>
              </Flex>
            </Flex>
          </div>
        ))}
      </Carousel>
    </Modal>
  );
}
