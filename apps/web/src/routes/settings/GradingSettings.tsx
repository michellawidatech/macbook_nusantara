/**
 * Grading configuration (owner ask 2026-08-27).
 *
 * Per product category — a MacBook and an iPad are inspected for different
 * things — Settings holds the criteria QC checks (Screen, Body, Ports…), the
 * conditions each can be found in, and the rule table that turns an inspection
 * into an A, a B or a C. `lib/grading.ts` carries the semantics; the QC bench
 * reads this through the grade button on each row of Serials & QC.
 *
 * Everything writes straight to the store, like the rest of Settings — the
 * only honest chrome is the page itself. Deleting a criterion or an option
 * also strips it out of every rule that referenced it, in the same mutation,
 * so no rule ever points at a check that no longer exists.
 */
import { useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Select,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useDb, mutate, nextId } from "../../mock/store.js";
import {
  GRADES,
  criteriaFor,
  rulesFor,
  type GradingRule,
} from "../../lib/grading.js";
import { useTranslation } from "react-i18next";

export function GradingSettings() {
  const { t } = useTranslation();
  const db = useDb();
  const { message, modal } = App.useApp();

  // Every category the catalogue knows plus any that already carries a
  // configuration — a category whose models were all deleted keeps its rules
  // reachable rather than orphaning them.
  const categories = [
    ...new Set([
      ...db.models.map((m) => m.category),
      ...db.gradingCriteria.map((c) => c.category),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const [category, setCategory] = useState<string>(
    () => db.gradingCriteria[0]?.category ?? categories[0] ?? "",
  );
  const [newCriterion, setNewCriterion] = useState("");
  const [newOption, setNewOption] = useState<Record<string, string>>({});

  const criteria = criteriaFor(db.gradingCriteria, category);
  const rules = rulesFor(db.gradingRules, category);

  const addCriterion = () => {
    const name = newCriterion.trim();
    if (!name) return;
    if (criteria.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return void message.warning(
        t(
          "settings.gradingCriterionExists",
          "“{{name}}” is already a criterion for {{category}}.",
          { name, category },
        ),
      );
    }
    mutate((d) => {
      d.gradingCriteria.push({ id: nextId("gc"), category, name, options: [] });
    });
    setNewCriterion("");
  };

  const addOption = (criterionId: string) => {
    const label = (newOption[criterionId] ?? "").trim();
    if (!label) return;
    mutate((d) => {
      const c = d.gradingCriteria.find((x) => x.id === criterionId);
      if (!c) return;
      if (c.options.some((o) => o.label.toLowerCase() === label.toLowerCase()))
        return;
      c.options.push({ id: nextId("gco"), label });
    });
    setNewOption((s) => ({ ...s, [criterionId]: "" }));
  };

  /** Drop one option, and every reference a rule holds to it. */
  const removeOption = (criterionId: string, optionId: string) => {
    mutate((d) => {
      const c = d.gradingCriteria.find((x) => x.id === criterionId);
      if (c) c.options = c.options.filter((o) => o.id !== optionId);
      for (const r of d.gradingRules) {
        for (const cond of r.conditions) {
          cond.optionIds = cond.optionIds.filter((id) => id !== optionId);
        }
        // A condition with nothing left to satisfy it is no condition at all.
        r.conditions = r.conditions.filter((x) => x.optionIds.length > 0);
      }
    });
  };

  const removeCriterion = (criterionId: string, name: string) => {
    modal.confirm({
      title: t("settings.gradingRemoveCriterion", "Remove “{{name}}”?", {
        name,
      }),
      content: t(
        "settings.gradingRemoveCriterionBody",
        "Its options go with it, and every rule that mentions it stops checking it. Grades already given to units are untouched.",
      ),
      okButtonProps: { danger: true },
      onOk: () =>
        mutate((d) => {
          d.gradingCriteria = d.gradingCriteria.filter(
            (c) => c.id !== criterionId,
          );
          for (const r of d.gradingRules) {
            r.conditions = r.conditions.filter(
              (x) => x.criterionId !== criterionId,
            );
          }
        }),
    });
  };

  const addRule = () => {
    mutate((d) => {
      d.gradingRules.push({
        id: nextId("gr"),
        category,
        grade: "B",
        conditions: [],
      });
    });
  };

  const moveRule = (ruleId: string, dir: -1 | 1) => {
    mutate((d) => {
      // Reorder within the category, then splice the category's block back
      // over the same positions so other categories' rules stay where they
      // are.
      const mine = d.gradingRules.filter((r) => r.category === category);
      const i = mine.findIndex((r) => r.id === ruleId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= mine.length) return;
      [mine[i], mine[j]] = [mine[j]!, mine[i]!];
      let n = 0;
      d.gradingRules = d.gradingRules.map((r) =>
        r.category === category ? mine[n++]! : r,
      );
    });
  };

  const setCondition = (
    ruleId: string,
    criterionId: string,
    optionIds: string[],
  ) => {
    mutate((d) => {
      const r = d.gradingRules.find((x) => x.id === ruleId);
      if (!r) return;
      r.conditions = r.conditions.filter((x) => x.criterionId !== criterionId);
      // No options picked = the rule says nothing about this criterion.
      if (optionIds.length > 0) r.conditions.push({ criterionId, optionIds });
    });
  };

  const ruleCard = (rule: GradingRule, index: number) => (
    <Card key={rule.id} size="small">
      <Flex vertical gap={12}>
        <Flex align="center" gap={8} wrap>
          <Typography.Text type="secondary">{index + 1}.</Typography.Text>
          <Select
            size="small"
            style={{ width: 90 }}
            value={rule.grade}
            aria-label={t("settings.gradingGrade", "Grade")}
            options={GRADES.map((g) => ({ value: g, label: g }))}
            onChange={(g) =>
              mutate((d) => {
                const r = d.gradingRules.find((x) => x.id === rule.id);
                if (r) r.grade = g;
              })
            }
          />
          {rule.conditions.length === 0 && (
            <Tag>{t("settings.gradingCatchAll", "matches every unit")}</Tag>
          )}
          <Flex gap={4} style={{ marginInlineStart: "auto" }}>
            <Tooltip title={t("settings.gradingCheckEarlier", "Check earlier")}>
              <Button
                size="small"
                type="text"
                disabled={index === 0}
                aria-label={t(
                  "settings.gradingMoveUpAria",
                  "Move rule {{n}} up",
                  { n: index + 1 },
                )}
                icon={<ArrowUpOutlined />}
                onClick={() => moveRule(rule.id, -1)}
              />
            </Tooltip>
            <Tooltip title={t("settings.gradingCheckLater", "Check later")}>
              <Button
                size="small"
                type="text"
                disabled={index === rules.length - 1}
                aria-label={t(
                  "settings.gradingMoveDownAria",
                  "Move rule {{n}} down",
                  { n: index + 1 },
                )}
                icon={<ArrowDownOutlined />}
                onClick={() => moveRule(rule.id, 1)}
              />
            </Tooltip>
            <Button
              size="small"
              type="text"
              danger
              aria-label={t(
                "settings.gradingRemoveRuleAria",
                "Remove rule {{n}}",
                { n: index + 1 },
              )}
              icon={<DeleteOutlined />}
              onClick={() =>
                mutate((d) => {
                  d.gradingRules = d.gradingRules.filter(
                    (r) => r.id !== rule.id,
                  );
                })
              }
            />
          </Flex>
        </Flex>
        <Flex gap={12} wrap>
          {criteria.map((c) => {
            const cond = rule.conditions.find((x) => x.criterionId === c.id);
            return (
              <Flex
                key={c.id}
                vertical
                gap={4}
                style={{ flex: "1 1 220px", minWidth: 180 }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.name}
                </Typography.Text>
                <Select
                  mode="multiple"
                  size="small"
                  allowClear
                  value={cond?.optionIds ?? []}
                  placeholder={t("settings.gradingAnyCondition", "Any")}
                  aria-label={c.name}
                  options={c.options.map((o) => ({
                    value: o.id,
                    label: o.label,
                  }))}
                  onChange={(ids: string[]) => setCondition(rule.id, c.id, ids)}
                />
              </Flex>
            );
          })}
        </Flex>
      </Flex>
    </Card>
  );

  return (
    <Flex vertical gap={16}>
      <Card title={t("settings.gradingConfiguration", "Grading configuration")}>
        <Flex vertical gap={16}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t(
              "settings.gradingIntro",
              "What QC checks a unit against, per category, and which combinations make each grade. The grade button on Inbound & QC reads this — and the person grading can always overwrite the answer.",
            )}
          </Typography.Paragraph>
          <Flex vertical gap={4} style={{ maxWidth: 320 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("settings.gradingCategory", "Category")}
            </Typography.Text>
            <Select
              value={category || undefined}
              placeholder={t("settings.gradingPickCategory", "Pick a category")}
              aria-label={t("settings.gradingCategory", "Category")}
              options={categories.map((c) => ({
                value: c,
                label: db.gradingCriteria.some((x) => x.category === c)
                  ? c
                  : `${c} — ${t("settings.gradingNotConfigured", "not configured")}`,
              }))}
              onChange={setCategory}
            />
          </Flex>
        </Flex>
      </Card>

      {category !== "" && (
        <Card
          title={t("settings.gradingCriteria", "Criteria — {{category}}", {
            category,
          })}
        >
          <Flex vertical gap={12}>
            {criteria.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "settings.gradingNoCriteria",
                  "Nothing is checked for this category yet. Add a criterion — Screen, Body, Ports…",
                )}
              />
            )}
            {criteria.map((c) => (
              <Card
                key={c.id}
                size="small"
                title={c.name}
                extra={
                  <Button
                    size="small"
                    type="text"
                    danger
                    aria-label={t(
                      "settings.gradingRemoveCriterionAria",
                      "Remove criterion {{name}}",
                      { name: c.name },
                    )}
                    icon={<DeleteOutlined />}
                    onClick={() => removeCriterion(c.id, c.name)}
                  />
                }
              >
                <Flex gap={6} wrap align="center">
                  {c.options.map((o) => (
                    <Tag
                      key={o.id}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        removeOption(c.id, o.id);
                      }}
                    >
                      {o.label}
                    </Tag>
                  ))}
                  <Input
                    size="small"
                    style={{ width: 160 }}
                    placeholder={t(
                      "settings.gradingAddOption",
                      "Add a condition",
                    )}
                    aria-label={t(
                      "settings.gradingAddOptionAria",
                      "Add a condition to {{name}}",
                      { name: c.name },
                    )}
                    value={newOption[c.id] ?? ""}
                    onChange={(e) =>
                      setNewOption((s) => ({ ...s, [c.id]: e.target.value }))
                    }
                    onPressEnter={() => addOption(c.id)}
                  />
                </Flex>
              </Card>
            ))}
            <Flex gap={8}>
              <Input
                style={{ width: 240 }}
                placeholder={t(
                  "settings.gradingNewCriterion",
                  "New criterion, e.g. Keyboard",
                )}
                aria-label={t(
                  "settings.gradingNewCriterionAria",
                  "New criterion",
                )}
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                onPressEnter={addCriterion}
              />
              <Button icon={<PlusOutlined />} onClick={addCriterion}>
                {t("settings.gradingAddCriterion", "Add criterion")}
              </Button>
            </Flex>
          </Flex>
        </Card>
      )}

      {category !== "" && criteria.length > 0 && (
        <Card
          title={t("settings.gradingRules", "Grades — {{category}}", {
            category,
          })}
          extra={
            <Button size="small" icon={<PlusOutlined />} onClick={addRule}>
              {t("settings.gradingAddRule", "Add rule")}
            </Button>
          }
        >
          <Flex vertical gap={12}>
            <Alert
              type="info"
              showIcon
              title={t(
                "settings.gradingHowRulesRead",
                "Rules are checked top to bottom; the first that fits wins.",
              )}
              description={t(
                "settings.gradingHowRulesReadBody",
                "A rule fits when the inspected unit matches every condition it sets — a criterion left on “Any” is not checked. A rule with no conditions fits every unit, so it belongs last, as the catch-all.",
              )}
            />
            {rules.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "settings.gradingNoRules",
                  "No grades are defined yet, so the QC modal cannot conclude one. Add a rule per grade.",
                )}
              />
            ) : (
              rules.map(ruleCard)
            )}
          </Flex>
        </Card>
      )}
    </Flex>
  );
}
