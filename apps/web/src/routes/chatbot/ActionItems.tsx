/**
 * What the bot left for a person to do in this chat (owner ask 2026-09-29):
 * *"show an interactive modal for any action the staff need to do, so they
 * don't have to re-read the entire conversation"*.
 *
 * One row per open task above the messages — on a phone too, where the
 * context panel is not drawn — and a dialog behind each. A negotiation's
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
} from "../../lib/inboxApi.js";

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
}

export function ActionItems({
  phone,
  actions,
  profile,
  onChanged,
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

  if (open.length === 0) return null;
  return (
    <>
      <Flex vertical gap={6} style={{ marginBottom: 12 }}>
        {open.map((a) => (
          <Alert
            key={a.id}
            type={a.kind === "NEGOTIATION" ? "warning" : "info"}
            showIcon={false}
            title={
              <Flex gap={8} align="center" wrap>
                <ActionKindTag kind={a.kind} />
                <Typography.Text>{a.summary}</Typography.Text>
                {a.kind === "NEGOTIATION" && a.askPrice && (
                  <Typography.Text type="secondary">
                    {t("chatAction.offers", "offers {{price}}", {
                      price: money(a.askPrice),
                    })}
                  </Typography.Text>
                )}
              </Flex>
            }
            action={
              <Button
                size="small"
                type="primary"
                onClick={() => setOpenId(a.id)}
              >
                {a.kind === "NEGOTIATION"
                  ? t("chatAction.answerOffer", "Answer offer")
                  : t("chatAction.open", "Open")}
              </Button>
            }
          />
        ))}
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
          {profile && (profile.name || profile.useCase || profile.budget) && (
            <Descriptions.Item label={t("chatAction.aboutThem", "About them")}>
              {[
                profile.name,
                profile.useCase,
                profile.budget
                  ? t("chatAction.budget", "budget {{budget}}", {
                      budget: fmtRp(Number(profile.budget)),
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
