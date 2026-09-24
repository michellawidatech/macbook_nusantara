/**
 * A serial you can click, and the one dialog it opens (owner ask 2026-09-21):
 * *"for any serial number that is clickable, when clicked, should have popup
 * modal instead of redirecting."*
 *
 * Until then a clickable serial was a `<Link>` to `/stock/history?serial=…`,
 * so checking one unit's history on Inventory, Inbound & QC or the service
 * bench left the page — and the search, the open popup and the half-done work
 * with it. Now it opens `SerialHistory` over the page and closing it puts the
 * page back exactly as it was.
 *
 * ## Why the dialog lives in the shell, not beside each link
 *
 * React bubbles events through a portal along the COMPONENT tree, not the DOM
 * one. A dialog rendered inside a table cell is, to React, inside that table:
 * a keystroke in its search box reaches `EditableTable`'s capture-phase arrow
 * handler, and a click reaches a row's own `onClick`. So there is ONE dialog,
 * mounted by `SerialHistoryHost` in `AppLayout`, and a link only asks it to
 * open. A link with no host above it — a page rendered on its own in a test —
 * falls back to a dialog of its own.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Button, Modal } from "antd";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDb } from "../mock/store.js";
import { SerialHistory } from "./SerialHistory";

const OpenSerial = createContext<((serial: string) => void) | null>(null);

/** The dialog itself. Its content is built only while it is open. */
function SerialHistoryModal({
  serial,
  onClose,
}: {
  serial: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={serial !== null}
      onCancel={onClose}
      footer={null}
      // Rebuilt for each serial, so a unit that moved while the page was open
      // shows where it is now — not where it was the last time it was asked.
      destroyOnHidden
      width={1040}
      title={t("serialHistory.title", "History — {{serial}}", {
        serial: serial ?? "",
      })}
    >
      {serial !== null && <HistoryBody serial={serial} onClose={onClose} />}
    </Modal>
  );
}

/** Split out so the store is read only while a dialog is open. */
function HistoryBody({
  serial,
  onClose,
}: {
  serial: string;
  onClose: () => void;
}) {
  const db = useDb();
  return <SerialHistory db={db} serial={serial} onBack={onClose} inDialog />;
}

/** Mounted once, in the shell: the dialog every `SerialLink` opens. */
export function SerialHistoryHost({ children }: { children: ReactNode }) {
  const [serial, setSerial] = useState<string | null>(null);
  const { pathname } = useLocation();

  // The shell outlives the page, so a dialog left open would follow somebody
  // to the next screen. Leaving the page closes it.
  useEffect(() => setSerial(null), [pathname]);

  return (
    <OpenSerial.Provider value={setSerial}>
      {children}
      <SerialHistoryModal serial={serial} onClose={() => setSerial(null)} />
    </OpenSerial.Provider>
  );
}

/**
 * A serial that opens its history in a popup. Monospace, like every serial in
 * the app; `children` replaces the text when a cell wants to show more.
 *
 * A link-styled BUTTON, not an `<a>`: an anchor with no `href` is neither
 * focusable nor announced as anything, so the keyboard could not reach it.
 * Its name is the serial itself — what somebody reads is what they can say.
 */
export function SerialLink({
  serial,
  children,
}: {
  serial: string;
  children?: ReactNode;
}) {
  const openInHost = useContext(OpenSerial);
  const [openHere, setOpenHere] = useState(false);

  const open = (e: MouseEvent) => {
    // The row under the link may open something of its own on a click.
    e.stopPropagation();
    if (openInHost !== null) openInHost(serial);
    else setOpenHere(true);
  };

  return (
    <>
      <Button
        type="link"
        size="small"
        aria-haspopup="dialog"
        onClick={open}
        style={{ padding: 0, height: "auto", fontFamily: "monospace" }}
      >
        {children ?? serial}
      </Button>
      {openInHost === null && (
        <SerialHistoryModal
          serial={openHere ? serial : null}
          onClose={() => setOpenHere(false)}
        />
      )}
    </>
  );
}
