/**
 * Nine photos of ten (client report 2026-11-07). The server stored every
 * photo it was sent — the tenth was skipped by the picker, and the only word
 * of it was a toast gone in four seconds. Now nothing stops the bench and
 * nothing is missed: each photo shows its own state on its tile, a photo that
 * did not go in stays as a red tile with its name until somebody deals with
 * it, the unit's row keeps a red count after the dialog closes, and an iPhone
 * HEIC that Chrome cannot open is converted rather than refused.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnitPhotos } from "../src/components/UnitPhotos.js";
import { PhotoStackButton } from "../src/components/PhotoStackButton.js";
import { getDb, qcPhotosOf } from "../src/mock/store.js";
import {
  PHOTO_MAX_BYTES,
  isHeicFile,
  looksLikePhoto,
  readPhoto,
} from "../src/lib/photoShrink.js";
import {
  __clearPhotoIssues,
  addPhotoIssues,
  photoIssuesOf,
} from "../src/lib/photoIssues.js";

const heicTo = vi.fn();
vi.mock("heic-to", () => ({ heicTo: (...a: unknown[]) => heicTo(...a) }));

const file = (name: string, type: string, bytes = 2048) =>
  new File([new Uint8Array(bytes).fill(7)], name, { type });

/** A canvas that encodes, which jsdom's does not. */
function workingCanvas(encodedBytes = 900) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect: () => {},
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (cb) {
      cb(
        new Blob([new Uint8Array(encodedBytes)], {
          type: "image/jpeg",
        }),
      );
    },
  );
}

const bitmap = () =>
  ({ width: 4032, height: 3024, close: () => {} }) as unknown as ImageBitmap;

beforeEach(() => {
  __clearPhotoIssues();
  heicTo.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("which files are photos", () => {
  it("goes by the type, and by the name when the browser gives no type", () => {
    expect(looksLikePhoto({ name: "lid.jpg", type: "image/jpeg" })).toBe(true);
    // AirDropped onto a desktop, an iPhone photo can arrive typeless.
    expect(looksLikePhoto({ name: "IMG_0412.HEIC", type: "" })).toBe(true);
    expect(
      looksLikePhoto({ name: "IMG_0412.MOV", type: "video/quicktime" }),
    ).toBe(false);
    // The edit sidecar that comes along with an edited iPhone photo.
    expect(looksLikePhoto({ name: "IMG_0412.AAE", type: "" })).toBe(false);
    expect(isHeicFile({ name: "IMG_1.heic", type: "" })).toBe(true);
    expect(isHeicFile({ name: "x", type: "image/heif" })).toBe(true);
    expect(isHeicFile({ name: "lid.jpg", type: "image/jpeg" })).toBe(false);
  });
});

describe("reading one photo", () => {
  it("converts an iPhone HEIC this browser cannot open into a JPEG", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("cannot decode")),
    );
    heicTo.mockResolvedValue(bitmap());
    workingCanvas();
    const read = await readPhoto(file("IMG_0412.HEIC", "image/heic", 3000));
    expect(heicTo).toHaveBeenCalledOnce();
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.url.startsWith("data:image/jpeg")).toBe(true);
  });

  it("converts even when the JPEG comes out bigger than the HEIC was", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("cannot decode")),
    );
    heicTo.mockResolvedValue(bitmap());
    workingCanvas(5000);
    const read = await readPhoto(file("IMG_0412.HEIC", "image/heic", 3000));
    expect(read.ok && read.url.startsWith("data:image/jpeg")).toBe(true);
  });

  it("refuses a HEIC that cannot be decoded even so", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("cannot decode")),
    );
    heicTo.mockRejectedValue(new Error("libheif: unsupported"));
    expect(await readPhoto(file("IMG_0412.HEIC", "image/heic"))).toEqual({
      ok: false,
      problem: "unreadable",
    });
  });

  it("never fetches the converter for an ordinary photo", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("out of memory")),
    );
    // A JPEG it could not shrink is kept as it came — it still displays.
    const read = await readPhoto(file("lid.jpg", "image/jpeg"));
    expect(read.ok).toBe(true);
    expect(heicTo).not.toHaveBeenCalled();
  });

  it("refuses one still over the limit", async () => {
    expect(
      await readPhoto(file("huge.jpg", "image/jpeg", PHOTO_MAX_BYTES + 1)),
    ).toEqual({ ok: false, problem: "too-big" });
  });
});

describe("picking ten photos when one is not a photo", () => {
  const pick = (container: HTMLElement, files: File[]) =>
    fireEvent.change(container.querySelector("input[type=file]")!, {
      target: { files },
    });
  const ten = () => [
    ...Array.from({ length: 9 }, (_, i) =>
      file(`IMG_04${10 + i}.jpg`, "image/jpeg"),
    ),
    file("IMG_0419.MOV", "video/quicktime"),
  ];

  it("saves nine, says so, and leaves the tenth as a red tile — no dialog", async () => {
    const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
    const before = qcPhotosOf(getDb(), serial).length;
    const { container, unmount } = render(
      <AntdApp>
        <UnitPhotos serial={serial} editable size={72} max={20} />
      </AntdApp>,
    );
    pick(container, ten());

    // Success is said, and each saved photo carries a tick.
    expect(
      await screen.findByText(`9 photo(s) added to ${serial}.`),
    ).toBeInTheDocument();
    expect(qcPhotosOf(getDb(), serial)).toHaveLength(before + 9);
    expect(screen.getAllByLabelText("Saved")).toHaveLength(9);

    // The tenth: a red tile, its name and why, and the count — nothing modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByLabelText("IMG_0419.MOV was not added"),
    ).toBeInTheDocument();
    expect(screen.getByText("IMG_0419.MOV")).toBeInTheDocument();
    expect(screen.getByText(/Not a photo/)).toBeInTheDocument();
    expect(screen.getByTestId("photo-count")).toHaveTextContent(
      `${before + 9} photo(s) · 1 not added`,
    );

    // It outlives the dialog, for the row to show.
    unmount();
    expect(photoIssuesOf(serial)).toHaveLength(1);
  });

  it("forgets a red tile once dismissed", async () => {
    const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
    addPhotoIssues(serial, [{ name: "IMG_0419.MOV", reason: "not-image" }]);
    render(
      <AntdApp>
        <UnitPhotos serial={serial} editable size={72} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByLabelText("Dismiss IMG_0419.MOV"));
    expect(screen.queryByLabelText("IMG_0419.MOV was not added")).toBeNull();
    expect(photoIssuesOf(serial)).toHaveLength(0);
  });

  it("puts the count on the row's photo button", () => {
    addPhotoIssues("draft:row-1", [
      { name: "IMG_0419.MOV", reason: "not-image" },
    ]);
    render(
      <AntdApp>
        <PhotoStackButton
          urls={[]}
          ariaLabel="Photos of row 1"
          onClick={() => {}}
          issueKey="draft:row-1"
        />
      </AntdApp>,
    );
    expect(screen.getByTitle("1 not added")).toBeInTheDocument();
    act(() => __clearPhotoIssues());
    expect(screen.queryByTitle("1 not added")).toBeNull();
  });
});
