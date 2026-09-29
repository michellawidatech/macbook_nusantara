/**
 * Work in progress kept on this device (owner ask 2026-09-21: *"remove the tab
 * view but the user must be able to drag the feature and open it in another
 * tab and all the things of the user input will be saved locally"*).
 *
 * `hooks/usePersistentState.ts` is what every draft rides on, so the promises
 * a page relies on are pinned here: a value outlives its component, two tabs
 * of the same page agree, a key built from a route follows the route, and an
 * emptied field is emptied everywhere.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  draftKey,
  usePersistentState,
} from "../src/hooks/usePersistentState.js";
import { asString } from "../src/lib/draftGuards.js";

/** What another tab writing this key looks like from here. */
function otherTabWrites(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

describe("usePersistentState", () => {
  it("outlives the component that typed it", () => {
    const key = draftKey("test.note");
    const first = renderHook(() => usePersistentState(key, "", asString));
    act(() => first.result.current[1]("half a sentence"));
    first.unmount();

    const again = renderHook(() => usePersistentState(key, "", asString));
    expect(again.result.current[0]).toBe("half a sentence");
  });

  it("takes up what another tab of the same page wrote", () => {
    const key = draftKey("test.shared");
    const here = renderHook(() => usePersistentState(key, "", asString));
    act(() => otherTabWrites(key, JSON.stringify("typed over there")));
    expect(here.result.current[0]).toBe("typed over there");
  });

  it("empties everywhere when a field is emptied", () => {
    // `undefined` is not JSON; it is written as a removal, which the other
    // tabs read as "back to the start".
    const key = draftKey("test.customer");
    const here = renderHook(() =>
      usePersistentState<string | undefined>(key, undefined, asString),
    );
    act(() => here.result.current[1]("cust-1"));
    expect(localStorage.getItem(key)).toBe('"cust-1"');
    act(() => here.result.current[1](undefined));
    expect(localStorage.getItem(key)).toBeNull();

    act(() => here.result.current[1]("cust-2"));
    act(() => otherTabWrites(key, null));
    expect(here.result.current[0]).toBeUndefined();
  });

  it("follows a key that changes under a live component", () => {
    // `/inbound/po-1` → `/inbound/po-2` is the same mounted page.
    localStorage.setItem(draftKey("test.po-2"), JSON.stringify("po-2's draft"));
    const { result, rerender } = renderHook(
      ({ po }: { po: string }) =>
        usePersistentState(draftKey(`test.${po}`), "", asString),
      { initialProps: { po: "po-1" } },
    );
    act(() => result.current[1]("po-1's draft"));
    rerender({ po: "po-2" });
    expect(result.current[0]).toBe("po-2's draft");
    rerender({ po: "po-1" });
    expect(result.current[0]).toBe("po-1's draft");
  });

  it("drops a stored value that no longer fits, and starts clean", () => {
    const key = draftKey("test.shape");
    localStorage.setItem(key, JSON.stringify({ an: "object" }));
    const { result } = renderHook(() =>
      usePersistentState(key, "fresh", asString),
    );
    expect(result.current[0]).toBe("fresh");
  });

  it("is ordinary state with a null key", () => {
    const { result } = renderHook(() =>
      usePersistentState<string>(null, "", asString),
    );
    act(() => result.current[1]("kept in memory only"));
    expect(result.current[0]).toBe("kept in memory only");
    expect(localStorage.length).toBe(0);
  });
});
