/**
 * What a page needs to know about the tab it is in (2026-09-15).
 *
 * Every open tab stays mounted — that is how half-typed work survives a
 * switch (see `AppTabs.tsx`) — so "mounted" no longer means "on screen".
 * Anything that listens to the whole document has to ask the second question,
 * or a scan fired at the till lands in an Inbound tab nobody is looking at.
 *
 * Outside the tab system — a page rendered on its own in a test — both answers
 * are the old ones: on screen, and scans straight to the scanner.
 */
import { createContext, useContext } from "react";
import { registerScanTarget, type ScanHandler } from "../lib/scanner.js";

/** True while this tab is the one on screen. */
export const TabActiveContext = createContext(true);

/**
 * Whether the page calling it is on screen. A document listener, a poll or a
 * global shortcut in a page should do nothing while this is false.
 */
export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}

/**
 * A tab's own stack of scan targets.
 *
 * Why a stack per tab rather than each `useScanTarget` unregistering while its
 * tab is hidden: the scanner's stack is last-in-wins, which is how a modal
 * takes scans from the page behind it. React runs a child's effects before
 * its parent's, so re-registering on the way back would put the PAGE on top
 * of its own modal. Here the order is fixed when the targets mount, and the
 * only thing that moves is one proxy — registered with the scanner while the
 * tab is on screen and something in it is listening, released otherwise, so
 * the scanner chip also stops saying "ready" on a tab that takes no scans.
 */
export interface TabScanRegistry {
  register(handler: ScanHandler): () => void;
  setActive(active: boolean): void;
}

export const TabScanContext = createContext<TabScanRegistry | null>(null);

export function useTabScanRegistry(): TabScanRegistry | null {
  return useContext(TabScanContext);
}

export function createTabScanRegistry(): TabScanRegistry {
  const stack: { handler: ScanHandler }[] = [];
  let active = false;
  let release: (() => void) | null = null;

  const sync = () => {
    const listening = active && stack.length > 0;
    if (listening && release === null) {
      release = registerScanTarget((serial) =>
        stack[stack.length - 1]?.handler(serial),
      );
    } else if (!listening && release !== null) {
      const done = release;
      release = null;
      done();
    }
  };

  return {
    register(handler) {
      const entry = { handler };
      stack.push(entry);
      sync();
      return () => {
        const index = stack.indexOf(entry);
        if (index !== -1) stack.splice(index, 1);
        sync();
      };
    },
    setActive(next) {
      active = next;
      sync();
    },
  };
}
