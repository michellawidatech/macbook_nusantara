/**
 * What the bot left for a person to do in this chat (owner ask 2026-09-29):
 * *"show an interactive modal for any action the staff need to do, so they
 * don't have to re-read the entire conversation"*.
 *
 * One line under the conversation header — on a phone too — and a dialog
 * behind each task. A negotiation's
 * dialog is a form: our price, the unit's cost (modal), the customer's offer
 * and a box for the shop's answer, which sends the offer and closes the task
 * in one press. Every other kind shows the bot's note, the customer's words
 * and the unit, and is closed by answering in the chat or by Done.
 *
 * The customer's offer is READ FROM THE CONVERSATION'S POLL, not held here: a
 * customer who writes "7,2 deh" while the dialog is open moves the figure on
 * screen (the worker upserts it), and the dialog says it changed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
} from "antd";
import type { TFunction } from "../../i18n/translate.js";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput.js";
import { fmtDateTime, fmtNone, fmtRp } from "../../lib/format.js";
import {
  finishAction,
  offerAction,
  type ChatAction,
  type ChatActionKind,
  type CustomerProfile,
  type Handoff,
} from "../../lib/inboxApi.js";
import { handoffTopicLabel } from "../../lib/handoffTopics.js";

/** "Rp a – Rp b", one figure, or None. */
export function budgetText(min: string | null, max: string | null): string {
  if (min && max && min !== max)
    return `${fmtRp(Number(min))} – ${fmtRp(Number(max))}`;
  const one = min ?? max;
  return one ? fmtRp(Number(one)) : fmtNone();
}

export function actionKindLabel(t: TFunction, kind: ChatActionKind): string {
  switch (kind) {
    case "NEGOTIATION":
      return t("chatAction.negotiation", "Negotiation");
    case "PRICE":
      return t("chatAction.price", "Price");
    case "STOCK":
      return t("chatAction.stock", "Stock");
    case "RESERVATION":
      return t("chatAction.reservation", "Booking");
    case "PHOTOS":
      return t("chatAction.photos", "Photos");
    default:
      return t("chatAction.other", "Needs you");
  }
}

const KIND_COLOR: Record<ChatActionKind, string> = {
  NEGOTIATION: "magenta",
  PRICE: "gold",
  STOCK: "blue",
  RESERVATION: "cyan",
  PHOTOS: "purple",
  OTHER: "volcano",
};

export function ActionKindTag({ kind }: { kind: ChatActionKind }) {
  const { t } = useTranslation();
  return (
    <Tag color={KIND_COLOR[kind]} style={{ marginInline: 0 }}>
      {actionKindLabel(t, kind)}
    </Tag>
  );
}

const money = (v: string | null) => (v === null ? fmtNone() : fmtRp(Number(v)));

/**
 * The sentence the customer reads, in the shop's voice. Not translated: it is
 * what goes to the customer, and the shop writes to customers in Indonesian
 * whatever language the screen is in. Staff can edit it before sending.
 */
function offerText(unit: ChatAction["unit"], price: number): string {
  const what = unit ? `unit ${unit.name}` : "unitnya";
  return `Untuk ${what} bisa kami kasih di ${fmtRp(price)} ya kak 😊`;
}

export interface ActionItemsProps {
  phone: string;
  actions: ChatAction[];
  profile: CustomerProfile | null;
  /** Refetch the conversation after a write. */
  onChanged: () => void;
  /** The thread's open hand-over, drawn on the same line when there is one. */
  handoff?: Handoff | null;
  /** "Mark handled": closes the hand-over and every task at once. */
  onMarkHandled?: () => void;
  marking?: boolean;
}

/**
 * ONE line under the conversation header (owner ask 2026-10-15) — an orange
 * tag, the bot's note and *Open*. It replaced a yellow banner and a stack of
 * cards, which between them pushed the conversation half off the screen.
 * More than one open task says "+n more"; *Open* takes the oldest, and the
 * next one is on the line once that is done.
 */
export function ActionItems({
  phone,
  actions,
  profile,
  onChanged,
  handoff = null,
  onMarkHandled,
  marking = false,
}: ActionItemsProps) {
  const { t } = useTranslation();
  const open = actions.filter((a) => a.status === "OPEN");
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * Opened once by itself, the first time this page sees a task — the owner
   * asked for the dialog to BE the way in, so a colleague lands on the form
   * rather than on a scrollback. Never re-opened after being closed, and never
   * opened over another dialog.
   */
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = open.find((a) => !seen.current.has(a.id));
    for (const a of open) seen.current.add(a.id);
    if (fresh && openId === null) setOpenId(fresh.id);
    // Keyed on the ids, not the array: a poll hands back a new array every time.
  }, [phone, open.map((a) => a.id).join(",")]);

  const current = actions.find((a) => a.id === openId) ?? null;
  const first = open[0];

  if (!first && !handoff) return null;
  const label = first
    ? actionKindLabel(t, first.kind)
    : handoffTopicLabel(t, handoff!.topic);
  const summary = first?.summary ?? handoff?.summary ?? "";
  return (
    <>
      <Flex
        align="center"
        gap={8}
        role="status"
        aria-label={t("chatAction.lineLabel", "Needs a person")}
        style={{ minWidth: 0 }}
      >
        <Tag color="orange" style={{ marginInline: 0, flexShrink: 0 }}>
          {label}
        </Tag>
        <Typography.Text
          ellipsis={{ tooltip: summary }}
          style={{ flex: 1, minWidth: 0 }}
        >
          {summary}
          {first?.kind === "NEGOTIATION" && first.askPrice
            ? ` · ${t("chatAction.offers", "offers {{price}}", {
                price: money(first.askPrice),
              })}`
            : ""}
        </Typography.Text>
        {open.length > 1 && (
          <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
            {t("chatAction.more", "+{{n}} more", { n: open.length - 1 })}
          </Typography.Text>
        )}
        {first && (
          <Button
            size="small"
            type="primary"
            style={{ flexShrink: 0 }}
            onClick={() => setOpenId(first.id)}
          >
            {t("chatAction.open", "Open")}
          </Button>
        )}
        {handoff && onMarkHandled && (
          <Button
            size="small"
            style={{ flexShrink: 0 }}
            loading={marking}
            onClick={onMarkHandled}
          >
            {t("chat.markHandled", "Mark handled")}
          </Button>
        )}
      </Flex>
      {current && (
        <ActionModal
          key={current.id}
          phone={phone}
          action={current}
          profile={profile}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function ActionModal({
  phone,
  action,
  profile,
  onClose,
  onChanged,
}: {
  phone: string;
  action: ChatAction;
  profile: CustomerProfile | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ price?: number; text: string }>();
  const [busy, setBusy] = useState<"offer" | "done" | null>(null);
  /** Whether the staff member has written the message themselves. */
  const [textTouched, setTextTouched] = useState(false);
  const negotiation = action.kind === "NEGOTIATION";

  /*
   * The offer when the dialog opened. A later poll carrying a different one
   * means the customer changed it while this was open — said above the form,
   * because the figure a person was about to answer has just moved.
   */
  const [openedAsk] = useState(action.askPrice);
  const moved = negotiation && openedAsk !== action.askPrice;

  const cost = action.cost === null ? null : Number(action.cost);
  const price = Form.useWatch("price", form);
  const margin = useMemo(
    () => (cost !== null && typeof price === "number" ? price - cost : null),
    [cost, price],
  );

  const onPrice = (v: number | null) => {
    if (!textTouched && typeof v === "number" && v > 0)
      form.setFieldValue("text", offerText(action.unit, v));
  };

  const send = () =>
    form.validateFields().then(async (v) => {
      if (typeof v.price !== "number") return;
      setBusy("offer");
      try {
        await offerAction(phone, action.id, {
          price: String(Math.round(v.price)),
          text: v.text.trim(),
        });
        message.success(
          t(
            "chatAction.offerQueued",
            "Offer queued. It goes out in a few seconds.",
          ),
        );
        onChanged();
        onClose();
      } catch (err) {
        message.error(
          err instanceof Error
            ? err.message
            : t("chatAction.offerFailed", "Could not send the offer."),
        );
      } finally {
        setBusy(null);
      }
    });

  const done = async () => {
    setBusy("done");
    try {
      await finishAction(phone, action.id);
      onChanged();
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatAction.doneFailed", "Could not mark it done."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      width={560}
      onCancel={onClose}
      title={
        <Flex gap={8} align="center">
          <ActionKindTag kind={action.kind} />
          <span>{action.summary}</span>
        </Flex>
      }
      footer={
        <Flex justify="space-between" gap={8} wrap>
          <Button loading={busy === "done"} onClick={() => void done()}>
            {t("chatAction.markDone", "Mark done")}
          </Button>
          <Flex gap={8}>
            <Button onClick={onClose}>{t("chatAction.close", "Close")}</Button>
            {negotiation && (
              <Button
                type="primary"
                loading={busy === "offer"}
                onClick={() => void send()}
              >
                {t("chatAction.sendOffer", "Send offer")}
              </Button>
            )}
          </Flex>
        </Flex>
      }
    >
      <Flex vertical gap={12}>
        {moved && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "chatAction.offerMoved",
              "The customer changed their offer while this was open: {{from}} → {{to}}.",
              { from: money(openedAsk), to: money(action.askPrice) },
            )}
          />
        )}

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label={t("chatAction.unit", "Unit")}>
            {action.unit ? (
              <>
                {action.unit.name}
                {action.unit.grade ? ` · ${action.unit.grade}` : ""}
                <Typography.Text type="secondary">
                  {" "}
                  · {action.unit.serial}
                </Typography.Text>
              </>
            ) : (
              t(
                "chatAction.noUnit",
                "Not named yet — check the chat for which one.",
              )
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t("chatAction.ourPrice", "Our price")}>
            {money(action.listPrice)}
          </Descriptions.Item>
          {negotiation && (
            <Descriptions.Item label={t("chatAction.cost", "Cost (modal)")}>
              {money(action.cost)}
            </Descriptions.Item>
          )}
          {negotiation && (
            <Descriptions.Item
              label={t("chatAction.customerOffer", "Customer's offer")}
            >
              <Typography.Text strong>{money(action.askPrice)}</Typography.Text>
              <Typography.Text type="secondary">
                {" "}
                · {fmtDateTime(action.updatedAt)}
              </Typography.Text>
            </Descriptions.Item>
          )}
          <Descriptions.Item label={t("chatAction.theyWrote", "They wrote")}>
            {action.customerText?.trim() || fmtNone()}
          </Descriptions.Item>
          {profile &&
            (profile.name ||
              profile.useCase ||
              profile.budgetMin ||
              profile.budgetMax) && (
              <Descriptions.Item
                label={t("chatAction.aboutThem", "About them")}
              >
                {[
                  profile.name,
                  profile.useCase,
                  profile.budgetMin || profile.budgetMax
                    ? t("chatAction.budget", "budget {{budget}}", {
                        budget: budgetText(
                          profile.budgetMin,
                          profile.budgetMax,
                        ),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Descriptions.Item>
            )}
        </Descriptions>

        {negotiation && (
          <Form form={form} layout="vertical" requiredMark>
            <Form.Item
              name="price"
              label={t("chatAction.yourPrice", "Your price")}
              rules={[
                {
                  required: true,
                  message: t(
                    "chatAction.priceRequired",
                    "Enter the price you will take.",
                  ),
                },
              ]}
              extra={
                margin !== null
                  ? t(
                      "chatAction.marginAt",
                      "Margin at this price: {{margin}}",
                      {
                        margin: fmtRp(margin),
                      },
                    )
                  : undefined
              }
            >
              <MoneyInput
                min={1}
                aria-label={t("chatAction.yourPrice", "Your price")}
                onChange={onPrice}
              />
            </Form.Item>
            <Form.Item
              name="text"
              label={t(
                "chatAction.messageToCustomer",
                "Message to the customer",
              )}
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: t(
                    "chatAction.messageRequired",
                    "Write what the customer reads.",
                  ),
                },
              ]}
            >
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={() => setTextTouched(true)}
              />
            </Form.Item>
          </Form>
        )}

        {!negotiation && (
          <Typography.Text type="secondary">
            {t(
              "chatAction.answerInChat",
              "Answer in the chat, then mark this done — or Mark handled on the chat closes every task at once.",
            )}
          </Typography.Text>
        )}
      </Flex>
    </Modal>
  );
}
