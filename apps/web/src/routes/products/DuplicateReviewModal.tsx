/**
 * Review duplicates — Master Product (owner ask 2026-10-21: "I need to clean
 * it up … I need a smart system"). Every group of live products that are one
 * product (`duplicateGroups`), what merging them would do per variant
 * (`planMerge`), and the two answers: merge into the one to keep, or "these
 * are different", which is remembered so the pair is not suggested again.
 */
import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Flex,
  Modal,
  Popconfirm,
  Radio,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
import {
  applyMerge,
  duplicateGroups,
  planMerge,
  type DuplicateGroup,
  type MergeStep,
} from "../../lib/catalogMerge.js";
import { isLiveSku } from "../../lib/skuCode.js";
import { COLUMN } from "../../theme/tokens";

export interface DuplicateReviewModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function DuplicateReviewModal({
  open,
  onClose,
}: DuplicateReviewModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const groups = duplicateGroups(db);

  return (
    <Modal
      open={open}
      title={t("dupReview.title", "Review duplicate products")}
      width={1100}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("common.close", "Close")}</Button>}
      destroyOnHidden
    >
      {groups.length === 0 ? (
        <Empty
          description={t(
            "dupReview.none",
            "No product is in the catalogue twice.",
          )}
        />
      ) : (
        <Flex vertical gap={16} style={{ maxHeight: "70vh", overflow: "auto" }}>
          {groups.map((g) => (
            <GroupCard key={g.key} group={g} />
          ))}
        </Flex>
      )}
    </Modal>
  );
}

function GroupCard({ group }: { readonly group: DuplicateGroup }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [keep, setKeep] = useState(group.target.id);
  const others = group.models.filter((m) => m.id !== keep).map((m) => m.id);
  const plan = planMerge(db, keep, others);
  const keepName = plan.name;

  const variantsOf = (id: string) =>
    db.skus.filter((s) => isLiveSku(s) && s.modelId === id).length;
  const heldOf = (id: string) => {
    const ids = new Set(
      db.skus.filter((s) => s.modelId === id).map((s) => s.id),
    );
    return db.units.filter(
      (u) =>
        ids.has(u.skuId) &&
        ["QC", "TERSEDIA", "DIRESERVASI", "SERVIS"].includes(u.status),
    ).length;
  };

  const merge = () => {
    mutate((d) => {
      // Planned again inside the write, against the store as it is now.
      const fresh = planMerge(d, keep, others);
      applyMerge(d, fresh, {
        nextId,
        appendEvent,
        staff: currentStaffName(),
        now: new Date().toISOString(),
      });
    });
    message.success(
      t("dupReview.merged", "Merged into {{name}}.", { name: keepName }),
    );
  };

  const different = () => {
    mutate((d) => {
      const ids = group.models.map((m) => m.id);
      for (const m of d.models) {
        if (!ids.includes(m.id)) continue;
        const mark = new Set(m.notDuplicateOf ?? []);
        for (const other of ids) if (other !== m.id) mark.add(other);
        m.notDuplicateOf = [...mark].sort();
      }
    });
    message.success(
      t(
        "dupReview.markedDifferent",
        "Noted — they will not be suggested again.",
      ),
    );
  };

  const actionTag = (s: MergeStep) => {
    switch (s.action) {
      case "MOVE":
        return (
          <Tag color="blue">
            {t("dupReview.moves", "Moves in as {{code}}", { code: s.code })}
          </Tag>
        );
      case "JOIN":
        return (
          <Tag color="green">
            {t("dupReview.joins", "Joins {{code}} · {{n}} unit(s) move", {
              code: s.code,
              n:
                s.heldUnits.length +
                [...s.counted.values()].reduce((a, b) => a + b, 0),
            })}
          </Tag>
        );
      case "DROP":
        return (
          <Tag>
            {t("dupReview.drops", "Same as {{code}} — removed (never used)", {
              code: s.code,
            })}
          </Tag>
        );
      case "STUCK":
        return (
          <Tag color="red">{t("dupReview.stuck", "Cannot be placed")}</Tag>
        );
    }
  };

  return (
    <Card size="small" title={keepName}>
      <Flex vertical gap={10}>
        <Typography.Text type="secondary">
          {t("dupReview.keepWhich", "Keep which product?")}
        </Typography.Text>
        <Radio.Group value={keep} onChange={(e) => setKeep(e.target.value)}>
          <Flex vertical gap={4}>
            {group.models.map((m) => (
              <Radio key={m.id} value={m.id}>
                <b>{m.name}</b>{" "}
                <Typography.Text type="secondary">
                  {t(
                    "dupReview.modelLine",
                    "{{v}} variant(s) · {{u}} unit(s) held",
                    { v: variantsOf(m.id), u: heldOf(m.id) },
                  )}
                </Typography.Text>
              </Radio>
            ))}
          </Flex>
        </Radio.Group>

        {plan.steps.length > 0 && (
          <Table<MergeStep>
            size="small"
            rowKey="skuId"
            pagination={false}
            dataSource={[...plan.steps]}
            columns={[
              {
                title: t("dupReview.variant", "Variant"),
                key: "from",
                render: (_, s) => (
                  <Flex vertical>
                    <span>{s.fromCode}</span>
                    <Typography.Text type="secondary">
                      {s.fromLabel}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("dupReview.becomes", "Becomes"),
                key: "action",
                render: (_, s) => actionTag(s),
              },
              {
                title: t("dupReview.label", "Options"),
                dataIndex: "label",
                width: COLUMN.code + 40,
              },
            ]}
          />
        )}

        {plan.stuck && (
          <Alert
            type="warning"
            showIcon
            message={t(
              "dupReview.stuckWhy",
              "Some variants cannot be placed in {{name}} — usually a processor the product to keep has and these do not name. Pick the other product to keep.",
              { name: keepName },
            )}
          />
        )}

        <Flex gap={8} justify="end">
          <Popconfirm
            title={t(
              "dupReview.differentConfirm",
              "These are different products?",
            )}
            okText={t("dupReview.differentOk", "Yes, different")}
            cancelText={t("common.cancel", "Cancel")}
            onConfirm={different}
          >
            <Button>{t("dupReview.different", "These are different")}</Button>
          </Popconfirm>
          <Popconfirm
            title={t("dupReview.mergeConfirm", "Merge into {{name}}?", {
              name: keepName,
            })}
            description={t(
              "dupReview.mergeDetail",
              "Units move with a line on their history. Variants with sales stay for old receipts. Cannot be undone from here.",
            )}
            okText={t("dupReview.mergeOk", "Merge")}
            cancelText={t("common.cancel", "Cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={merge}
            disabled={plan.stuck}
          >
            <Button type="primary" disabled={plan.stuck}>
              {t("dupReview.merge", "Merge into {{name}}", { name: keepName })}
            </Button>
          </Popconfirm>
        </Flex>
      </Flex>
    </Card>
  );
}
