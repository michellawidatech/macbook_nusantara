/**
 * Category → product → unit, as ONE filter (owner ask 2026-09-19).
 *
 * The S/N tracker's list is filtered by category, by product and by unit
 * (variant), and those three nest: a category holds products and a product
 * holds its variants. So they are one tree rather than three dropdowns that
 * could contradict each other — `lib/serialTracker.ts` says more.
 *
 * Two renderings of one state, which is the arrangement `ProTable` uses for its
 * own header filters, and for its reason: `DataTable` draws cards on a phone,
 * and a card has no column header to hang a filter on.
 *
 * - `CatalogueFilterPanel` is the column header's dropdown (`filterDropdown`):
 *   a checkable tree with the categories open on their products, and a search
 *   that opens the branches holding a match and marks it — what antd's own
 *   tree filter does.
 * - `CatalogueFilterSelect` is the same tree as a tree select, for the
 *   toolbar on a phone.
 *
 * Both take and give VARIANT ids, which is what a row is tested against.
 * `ProTable` cannot hold this state itself — its facets are one flat list of a
 * column's own values — so the page holds it, narrows the rows before handing
 * them over, and lights the column's funnel through `filtered`.
 */
import { useMemo, useState, type Key } from "react";
import { Button, Flex, Input, Tree, TreeSelect } from "antd";
import type { TreeDataNode } from "antd";
import { useTranslation } from "react-i18next";
import { SPACE } from "../theme/tokens";
import { fmtNone } from "../lib/format.js";
import {
  skuKey,
  skuOfKey,
  skusUnder,
  type CatalogueNode,
} from "../lib/serialTracker.js";

export interface CatalogueFilterProps {
  /** The tree to pick from — `catalogueTree` over the rows the list holds. */
  tree: readonly CatalogueNode[];
  /** The picked variants (`Sku.id`). Empty means every unit. */
  value: readonly string[];
  onChange: (skuIds: string[]) => void;
}

/**
 * A node with no name still needs something a person can see and tick. The
 * word follows the language, which is why the trees below are rebuilt on `t`.
 */
const titleOf = (n: CatalogueNode) => (n.title === "" ? fmtNone() : n.title);

function toTreeData(nodes: readonly CatalogueNode[]): TreeDataNode[] {
  return nodes.map((n) => ({
    key: n.key,
    title: titleOf(n),
    ...(n.children === undefined ? {} : { children: toTreeData(n.children) }),
  }));
}

/** Every variant key in the tree — what a checked key must be one of. */
function leafKeys(nodes: readonly CatalogueNode[], out = new Set<string>()) {
  for (const n of nodes) {
    if (n.children === undefined) out.add(n.key);
    else leafKeys(n.children, out);
  }
  return out;
}

/**
 * The branches to open so every node matching `needle` is on screen — the
 * parents of each match, which `autoExpandParent` then opens all the way up.
 */
function parentsOfMatches(
  nodes: readonly CatalogueNode[],
  needle: string,
  parent?: string,
  out: string[] = [],
): string[] {
  for (const n of nodes) {
    if (parent !== undefined && titleOf(n).toLowerCase().includes(needle)) {
      out.push(parent);
    }
    if (n.children !== undefined) {
      parentsOfMatches(n.children, needle, n.key, out);
    }
  }
  return out;
}

/**
 * The header's dropdown: search, the tree, and Clear / Done.
 *
 * Every tick applies at once — the list behind the dropdown narrows while it
 * is still open — so Done only closes it. That differs from antd's own
 * filters, which wait for OK, and on purpose: a tree is ticked a branch at a
 * time, and watching the count move is how somebody knows a tick landed.
 */
export function CatalogueFilterPanel({
  tree,
  value,
  onChange,
  onDone,
}: CatalogueFilterProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const categories = useMemo(() => tree.map((n) => n.key), [tree]);
  const [expanded, setExpanded] = useState<Key[]>(categories);
  const [autoExpand, setAutoExpand] = useState(false);
  const treeData = useMemo(() => toTreeData(tree), [tree, t]);
  const leaves = useMemo(() => leafKeys(tree), [tree]);
  const needle = search.trim().toLowerCase();

  const find = (next: string) => {
    setSearch(next);
    const n = next.trim().toLowerCase();
    setExpanded(n === "" ? categories : parentsOfMatches(tree, n));
    setAutoExpand(true);
  };

  return (
    <div
      style={{
        padding: SPACE.sm,
        width: 320,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <Input
        size="small"
        allowClear
        value={search}
        placeholder={t(
          "snTracking.findInTree",
          "Find a category, product or unit",
        )}
        aria-label={t(
          "snTracking.findInTree",
          "Find a category, product or unit",
        )}
        onChange={(e) => find(e.target.value)}
      />
      <div style={{ maxHeight: 320, overflowY: "auto", marginBlock: SPACE.sm }}>
        <Tree
          checkable
          selectable={false}
          blockNode
          treeData={treeData}
          // Only keys the tree still holds: a variant whose last unit moved
          // to another product would otherwise be a tick with no box.
          checkedKeys={value.map(skuKey).filter((k) => leaves.has(k))}
          expandedKeys={expanded}
          autoExpandParent={autoExpand}
          onExpand={(keys) => {
            setExpanded(keys);
            setAutoExpand(false);
          }}
          // Parents arrive here too, conducted from their children; only the
          // variants are kept, because a variant is what a row carries.
          onCheck={(checked) => {
            const keys = Array.isArray(checked) ? checked : checked.checked;
            onChange(
              keys
                .map((k) => skuOfKey(String(k)))
                .filter((s): s is string => s !== null),
            );
          }}
          {...(needle === ""
            ? {}
            : {
                filterTreeNode: (node) =>
                  String(node.title ?? "")
                    .toLowerCase()
                    .includes(needle),
              })}
        />
      </div>
      <Flex justify="space-between" gap={SPACE.sm}>
        <Button
          type="link"
          size="small"
          disabled={value.length === 0}
          onClick={() => onChange([])}
        >
          {t("snTracking.clear", "Clear")}
        </Button>
        <Button type="primary" size="small" onClick={onDone}>
          {t("common.done", "Done")}
        </Button>
      </Flex>
    </div>
  );
}

function toSelectData(nodes: readonly CatalogueNode[]): TreeDataNode[] {
  return nodes.map((n) => ({
    key: n.key,
    value: n.key,
    title: titleOf(n),
    ...(n.children === undefined ? {} : { children: toSelectData(n.children) }),
  }));
}

/**
 * The same filter as a tree select — the toolbar's control on a phone.
 *
 * `SHOW_PARENT`, so a whole category reads as one tag ("iPad") rather than as
 * every variant under it; what it hands back is expanded to variants again by
 * `skusUnder`, so the page only ever holds one shape.
 */
export function CatalogueFilterSelect({
  tree,
  value,
  onChange,
}: CatalogueFilterProps) {
  const { t } = useTranslation();
  const treeData = useMemo(() => toSelectData(tree), [tree, t]);
  const leaves = useMemo(() => leafKeys(tree), [tree]);
  return (
    <TreeSelect<string[]>
      treeCheckable
      showCheckedStrategy={TreeSelect.SHOW_PARENT}
      treeData={treeData}
      value={value.map(skuKey).filter((k) => leaves.has(k))}
      onChange={(keys) => onChange(skusUnder(tree, keys ?? []))}
      showSearch={{ treeNodeFilterProp: "title" }}
      allowClear
      maxTagCount="responsive"
      placeholder={t("snTracking.anyUnit", "Any category, product or unit")}
      aria-label={t("snTracking.anyUnit", "Any category, product or unit")}
      style={{ minWidth: 240 }}
    />
  );
}
