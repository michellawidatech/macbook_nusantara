/**
 * Who this customer is, as the bot has pieced it together (owner ask
 * 2026-10-15) — the right-hand column of /chat, which replaced the "Context"
 * prose panel. Fifty customers a day and three staff: nobody reads every
 * message, so the profile has to carry the conversation.
 *
 * Every field is correctable in place (`PATCH /api/inbox/:phone/profile`),
 * and the tag lists take a "+" to add and a × to remove. The age and the
 * job/school are the bot's GUESSES and say so beside the value; a guess shown
 * as a fact is how a 40-year-old gets offered the student discount.
 */
import { useRef, useState, type ReactNode } from "react";
import {
  App,
  Button,
  Flex,
  Input,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  FireFilled,
  PlusOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput.js";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  addProfileFact,
  patchProfile,
  removeProfileFact,
  type InboxConversation,
  type ProfileFact,
  type ProfileFactKind,
  type ProfilePatch,
} from "../../lib/inboxApi.js";
import { ActionKindTag, budgetText } from "./ActionItems.js";

/** A labelled block. Keeps every section the same shape. */
function Section({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Flex vertical gap={6}>
        <Flex justify="space-between" align="center" gap={8}>
          <Typography.Text
            type="secondary"
            strong
            style={{ fontSize: 12, letterSpacing: 0.4 }}
          >
            {title.toUpperCase()}
          </Typography.Text>
          {extra}
        </Flex>
        {children}
      </Flex>
    </section>
  );
}

/**
 * A value with a pencil beside it; the pencil swaps in a box. Enter or
 * leaving the box saves, Escape walks away. An emptied box saves null —
 * "the bot got this wrong and there is nothing to put instead".
 */
function EditableField({
  label,
  value,
  estimate,
  onSave,
}: {
  label: string;
  value: string | null;
  estimate?: boolean;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const commit = async () => {
    setEditing(false);
    if (cancelled.current) return;
    const v = draft.trim() || null;
    if (v !== (value ?? null)) await onSave(v);
  };

  return (
    <div>
      <Flex align="center" gap={6}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
        {estimate && (
          <Tag style={{ marginInline: 0, fontSize: 11, lineHeight: "16px" }}>
            {t("chatProfile.estimate", "estimate")}
          </Tag>
        )}
      </Flex>
      {editing ? (
        <Input
          size="small"
          autoFocus
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => e.currentTarget.blur()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={() => void commit()}
        />
      ) : (
        <Flex align="center" gap={4}>
          <Typography.Text
            strong={value !== null}
            type={value === null ? "secondary" : undefined}
          >
            {value ?? fmtNone()}
          </Typography.Text>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={t("chatProfile.editField", "Edit {{field}}", {
              field: label,
            })}
            onClick={() => {
              cancelled.current = false;
              setDraft(value ?? "");
              setEditing(true);
            }}
          />
        </Flex>
      )}
    </div>
  );
}

/** Budget: two money boxes edited together, saved as rupiah strings. */
function BudgetField({
  min,
  max,
  onSave,
}: {
  min: string | null;
  max: string | null;
  onSave: (patch: ProfilePatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [lo, setLo] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const asString = (n: number | null) =>
    n === null || !Number.isFinite(n) || n <= 0 ? null : String(Math.round(n));

  if (!editing)
    return (
      <Flex align="center" gap={4}>
        <Typography.Text
          strong={Boolean(min ?? max)}
          type={(min ?? max) ? undefined : "secondary"}
        >
          {budgetText(min, max)}
        </Typography.Text>
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          aria-label={t("chatProfile.editField", "Edit {{field}}", {
            field: t("chatProfile.budget", "Budget"),
          })}
          onClick={() => {
            setLo(min ? Number(min) : null);
            setHi(max ? Number(max) : null);
            setEditing(true);
          }}
        />
      </Flex>
    );

  return (
    <Flex vertical gap={6}>
      <MoneyInput
        aria-label={t("chatProfile.budgetMin", "Budget from")}
        placeholder={t("chatProfile.budgetMin", "Budget from")}
        value={lo ?? undefined}
        onChange={setLo}
      />
      <MoneyInput
        aria-label={t("chatProfile.budgetMax", "Budget up to")}
        placeholder={t("chatProfile.budgetMax", "Budget up to")}
        value={hi ?? undefined}
        onChange={setHi}
      />
      <Space>
        <Button
          size="small"
          type="primary"
          icon={<CheckOutlined />}
          onClick={() => {
            setEditing(false);
            void onSave({ budgetMin: asString(lo), budgetMax: asString(hi) });
          }}
        >
          {t("chatProfile.save", "Save")}
        </Button>
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={() => setEditing(false)}
        >
          {t("chatProfile.cancel", "Cancel")}
        </Button>
      </Space>
    </Flex>
  );
}

/** "+" that turns into a box; Enter adds the fact. */
function AddFact({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!editing)
    return (
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        aria-label={label}
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
      />
    );
  const commit = async () => {
    setEditing(false);
    const v = draft.trim();
    if (v) await onAdd(v);
  };
  return (
    <Input
      size="small"
      autoFocus
      aria-label={label}
      style={{ width: 140 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPressEnter={(e) => e.currentTarget.blur()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft("");
          e.currentTarget.blur();
        }
      }}
      onBlur={() => void commit()}
    />
  );
}

export interface CustomerProfilePanelProps {
  phone: string;
  conversation: InboxConversation;
  /** Refetch after a write. */
  onChanged: () => void;
}

export function CustomerProfilePanel({
  phone,
  conversation,
  onChanged,
}: CustomerProfilePanelProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const {
    token: { colorError },
  } = theme.useToken();
  const profile = conversation.profile;
  const lead = conversation.lead ?? { on: false, score: null, by: null };
  const facts = profile?.facts ?? [];
  const factsOf = (kind: ProfileFactKind) =>
    facts.filter((f) => f.kind === kind);

  const fail = (err: unknown, fallback: string) =>
    message.error(err instanceof Error ? err.message : fallback);

  const save = async (patch: ProfilePatch) => {
    try {
      await patchProfile(phone, patch);
      onChanged();
    } catch (err) {
      fail(err, t("chatProfile.saveFailed", "Could not save that."));
    }
  };

  const add = (kind: ProfileFactKind) => async (value: string) => {
    try {
      await addProfileFact(phone, { kind, value });
      onChanged();
    } catch (err) {
      fail(err, t("chatProfile.saveFailed", "Could not save that."));
    }
  };

  const remove = async (fact: ProfileFact) => {
    try {
      await removeProfileFact(phone, fact.id);
      onChanged();
    } catch (err) {
      fail(err, t("chatProfile.saveFailed", "Could not save that."));
    }
  };

  const removeLabel = (f: ProfileFact) =>
    t("chatProfile.removeFact", "Remove {{value}}", { value: f.value });

  /** One kind of fact as tags, with the old free text under it if set. */
  const tagList = (
    kind: ProfileFactKind,
    addLabel: string,
    extra?: ReactNode,
  ) => (
    <Flex vertical gap={6}>
      <Flex wrap gap={6} align="center">
        {factsOf(kind).map((f) => (
          <Tag
            key={f.id}
            style={{ marginInline: 0 }}
            closable={{ "aria-label": removeLabel(f) }}
            onClose={(e) => {
              e.preventDefault();
              void remove(f);
            }}
          >
            {f.value}
          </Tag>
        ))}
        <AddFact label={addLabel} onAdd={add(kind)} />
      </Flex>
      {extra}
    </Flex>
  );

  const openTasks = (conversation.actions ?? []).filter(
    (a) => a.status === "OPEN",
  );
  const reservations = conversation.reservations ?? [];

  return (
    <Flex vertical gap={18}>
      <Flex align="center" justify="space-between" gap={8}>
        <Flex align="center" gap={8}>
          <FireFilled style={{ color: lead.on ? colorError : undefined }} />
          <Typography.Text strong>
            {t("chatProfile.lead", "Lead")}
          </Typography.Text>
          {lead.score !== null && (
            <Tooltip
              title={t(
                "chatProfile.scoreHint",
                "How likely the bot thinks this customer is to buy, 0–100.",
              )}
            >
              <Typography.Text type="secondary">
                {t("chatProfile.botScore", "Bot score {{score}}", {
                  score: lead.score,
                })}
              </Typography.Text>
            </Tooltip>
          )}
        </Flex>
        {/*
         * Read-only (owner, 2026-10-21: "the user cannot choose / determine
         * the lead"). The bot's score sets the 🔥 and a sale clears it.
         */}
        {lead.on && (
          <Tag color="red" style={{ marginInline: 0 }}>
            {t("chat.tagLead", "Lead")}
          </Tag>
        )}
      </Flex>

      <Section title={t("chatProfile.summary", "Summary")}>
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
          type={conversation.summary ? undefined : "secondary"}
        >
          {conversation.summary?.text ?? fmtNone()}
        </Typography.Paragraph>
      </Section>

      <Section title={t("chatProfile.about", "About")}>
        <EditableField
          label={t("chatProfile.name", "Name")}
          value={profile?.name ?? null}
          onSave={(name) => save({ name })}
        />
        <EditableField
          label={t("chatProfile.age", "Age")}
          estimate
          value={profile?.ageEstimate ?? null}
          onSave={(ageEstimate) => save({ ageEstimate })}
        />
        <EditableField
          label={t("chatProfile.occupation", "Job or school")}
          estimate
          value={profile?.occupation ?? null}
          onSave={(occupation) => save({ occupation })}
        />
      </Section>

      <Section title={t("chatProfile.budget", "Budget")}>
        <BudgetField
          min={profile?.budgetMin ?? null}
          max={profile?.budgetMax ?? null}
          onSave={save}
        />
      </Section>

      <Section title={t("chatProfile.usage", "Usage")}>
        {tagList(
          "USAGE",
          t("chatProfile.addUsage", "Add a usage"),
          profile?.useCase ? (
            <EditableField
              label={t("chatProfile.useCase", "In their words")}
              value={profile.useCase}
              onSave={(useCase) => save({ useCase })}
            />
          ) : null,
        )}
      </Section>

      <Section title={t("chatProfile.apps", "Apps")}>
        {tagList("APP", t("chatProfile.addApp", "Add an app"))}
      </Section>

      <Section title={t("chatProfile.preferences", "Preferences")}>
        {tagList(
          "PREFERENCE",
          t("chatProfile.addPreference", "Add a preference"),
          profile?.preference ? (
            <EditableField
              label={t("chatProfile.preference", "In their words")}
              value={profile.preference}
              onSave={(preference) => save({ preference })}
            />
          ) : null,
        )}
      </Section>

      <Section
        title={t("chatProfile.other", "Other")}
        extra={
          <AddFact
            label={t("chatProfile.addOther", "Add something else")}
            onAdd={add("ABOUT")}
          />
        }
      >
        {factsOf("ABOUT").length === 0 ? (
          <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {factsOf("ABOUT").map((f) => (
              <li key={f.id}>
                <Flex align="center" justify="space-between" gap={4}>
                  <span>{f.value}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    aria-label={removeLabel(f)}
                    onClick={() => void remove(f)}
                  />
                </Flex>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("chatProfile.currentDevice", "Current device")}>
        <EditableField
          label={t("chatProfile.currentDevice", "Current device")}
          value={profile?.currentDevice ?? null}
          onSave={(currentDevice) => save({ currentDevice })}
        />
      </Section>

      <Section title={t("chatProfile.reservations", "Reservations")}>
        {reservations.length === 0 ? (
          <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
        ) : (
          reservations.map((r) => (
            <Flex key={r.code} vertical gap={2}>
              <Typography.Text strong>{r.code}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("chatProfile.visit", "Visit: {{when}}", {
                  when: r.scheduledFor
                    ? fmtDateTime(r.scheduledFor)
                    : fmtNone(),
                })}
              </Typography.Text>
              {r.units.map((u, i) => (
                <Typography.Text key={`${u.serial ?? ""}:${i}`}>
                  {u.serial ? `${u.name} · ${u.serial}` : u.name}
                </Typography.Text>
              ))}
            </Flex>
          ))
        )}
      </Section>

      <Section title={t("chatProfile.openTasks", "Open tasks")}>
        {openTasks.length === 0 ? (
          <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
        ) : (
          openTasks.map((a) => (
            <Flex key={a.id} gap={6} align="baseline">
              <ActionKindTag kind={a.kind} />
              <Typography.Text>{a.summary}</Typography.Text>
            </Flex>
          ))
        )}
      </Section>
    </Flex>
  );
}
