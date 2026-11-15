/**
 * The phone's app bar (owner-approved mockup, 2026-11-16): the title, ONE
 * labelled action, and "More ▾" opening a sheet of text rows. It replaced a
 * float-button fan of icons.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlusOutlined, DownloadOutlined } from "@ant-design/icons";
import { PageContainer } from "../src/components/PageContainer.js";
import { pressPageAction } from "./pageActions.js";

function renderPage(onAdd = vi.fn(), onExport = vi.fn(), onPrint = vi.fn()) {
  render(
    <MemoryRouter>
      <PageContainer
        title="Inventory"
        actions={[
          {
            key: "export",
            label: "Export stock",
            icon: <DownloadOutlined />,
            onClick: onExport,
          },
          {
            key: "add",
            label: "Add product",
            icon: <PlusOutlined />,
            type: "primary",
            onClick: onAdd,
          },
        ]}
        phoneMenu={[{ key: "print", label: "Print labels", onClick: onPrint }]}
      >
        <div>body</div>
      </PageContainer>
    </MemoryRouter>,
  );
  return { onAdd, onExport, onPrint };
}

describe("the phone app bar", () => {
  it("shows the primary action in words and nothing icon-only", () => {
    const { onAdd } = renderPage();
    expect(screen.getByRole("heading", { name: "Inventory" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Add product/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    // The other action is not on the bar — it is a row behind More.
    expect(screen.queryByRole("button", { name: /Export stock/ })).toBeNull();
    expect(screen.queryByLabelText("Page actions")).toBeNull();
    expect(
      screen.getByRole("button", { name: "More actions" }),
    ).toHaveTextContent("More");
  });

  it("puts the rest, and the page's phone menu, in a sheet of text rows", () => {
    const { onExport, onPrint } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const sheet = screen.getByRole("dialog");
    const rows = within(sheet)
      .getAllByRole("button")
      .filter((b) => b.textContent !== "");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Export stock",
      "Print labels",
    ]);
    fireEvent.click(
      within(sheet).getByRole("button", { name: /Print labels/ }),
    );
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("is reachable from pressPageAction either way", () => {
    const { onExport, onAdd } = renderPage();
    pressPageAction(/Export stock/);
    expect(onExport).toHaveBeenCalledTimes(1);
    pressPageAction(/Add product/);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("draws one non-primary action as its own button", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <PageContainer
          title="Returns"
          actions={[{ key: "x", label: "From customer", onClick }]}
        >
          <div />
        </PageContainer>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "From customer" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
