# Label printer on Windows (the iMac running Windows)

The POS prints one 50 × 30 mm sticker per page, landscape: the QR on the left
with the serial under it, the product name and SKU code on the right. Since
2026-11-03 the labels print from a frame that holds only the stickers, so
Chrome sizes the paper to 50 × 30 mm by itself. These steps make the Windows
driver agree with it. Do them once.

## 1. Give the driver a 50 × 30 mm paper

1. Start → **Printers & scanners** → the label printer → **Printing
   preferences**.
2. Paper / Stock: create or pick a size **50 mm wide × 30 mm high**. Name it
   `Label 50x30`. If the driver only offers 30 × 50, pick that and set
   **Orientation: Landscape**.
3. Margins 0, no scaling, no "fit to page". Apply.
4. In the same window, set it as the default paper.

## 2. Print once from Chrome and check the dialog

In the POS, Inventory → a line's ⋯ → **Print barcode** → **Print**. In
Chrome's print dialog:

- **Destination**: the label printer.
- **More settings** → **Paper size**: `Label 50x30` (it is usually picked
  already). **Margins: None**. **Scale: Default** (100). Untick **Headers and
  footers**.

The preview should show one sticker per page, filling it. If the preview is
right and the sticker is not, the driver's paper (step 1) is the cause.

## 3. Optional: print with no dialog

Chrome remembers the dialog's choices. To skip the dialog entirely, as the old
printer did, start Chrome with kiosk printing. It then prints straight to the
**Windows default printer**, so make the label printer the default first.

1. Right-click the Chrome shortcut you use for the POS → **Properties**.
2. At the end of **Target**, after the closing quote, add a space and
   `--kiosk-printing`.
3. Close every Chrome window and open the POS from that shortcut.

⚠️ With kiosk printing on, EVERY print from that Chrome goes to the default
printer with no dialog, invoices included. Keep a second, ordinary Chrome
shortcut for invoices, or only use the kiosk shortcut at the labelling desk.
