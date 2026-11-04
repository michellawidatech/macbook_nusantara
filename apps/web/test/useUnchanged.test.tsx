/** The shared "nothing changed" test behind every grey Save (2026-11-04). */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sameValue, useUnchanged } from "../src/hooks/useUnchanged.js";

describe("sameValue", () => {
  it("treats an undefined key as absent, and arrays by order", () => {
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
    expect(sameValue("", undefined)).toBe(false);
  });
});

describe("useUnchanged", () => {
  it("is true on open, false after an edit, true once it is undone, and resets with its key", () => {
    const { result, rerender } = renderHook(
      ({ v, k }: { v: { n: number }; k: string }) => useUnchanged(v, v, k),
      { initialProps: { v: { n: 1 }, k: "a" } },
    );
    expect(result.current).toBe(true);
    const h = renderHook(({ cur }: { cur: number }) => useUnchanged(1, cur), {
      initialProps: { cur: 1 },
    });
    h.rerender({ cur: 2 });
    expect(h.result.current).toBe(false);
    h.rerender({ cur: 1 });
    expect(h.result.current).toBe(true);
    const k = renderHook(
      ({ init, cur, key }: { init: number; cur: number; key: string }) =>
        useUnchanged(init, cur, key),
      { initialProps: { init: 1, cur: 1, key: "a" } },
    );
    k.rerender({ init: 5, cur: 5, key: "b" });
    expect(k.result.current).toBe(true);
    k.rerender({ init: 5, cur: 6, key: "b" });
    expect(k.result.current).toBe(false);
    rerender({ v: { n: 1 }, k: "a" });
  });
});

describe("useOpenedWith", () => {
  it("captures what a dialog's load effect set, then reports a change", async () => {
    const { useOpenedWith } = await import("../src/hooks/useUnchanged.js");
    const { useEffect, useState } = await import("react");
    const { act } = await import("@testing-library/react");
    let setName: (v: string) => void = () => undefined;
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => {
        const [name, set] = useState("");
        setName = set;
        // The dialog's own load, as every edit dialog has one.
        useEffect(() => set(`loaded-${id}`), [id]);
        return { unchanged: useOpenedWith({ name }, id), name };
      },
      { initialProps: { id: "a" } },
    );
    expect(result.current.name).toBe("loaded-a");
    expect(result.current.unchanged).toBe(true);
    act(() => setName("typed"));
    expect(result.current.unchanged).toBe(false);
    act(() => setName("loaded-a"));
    expect(result.current.unchanged).toBe(true);
    rerender({ id: "b" });
    expect(result.current.name).toBe("loaded-b");
    expect(result.current.unchanged).toBe(true);
  });
});
