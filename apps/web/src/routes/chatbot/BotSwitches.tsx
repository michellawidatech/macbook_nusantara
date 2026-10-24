/**
 * What the bot may answer for itself — four switches for the whole shop
 * (owner ask 2026-09-29): Stock, Price, Reservations, Photos.
 *
 * On, the bot answers from the POS. Off, that kind of question goes to a
 * person, and the conversation gets an action item with the bot's note, so
 * nobody has to read the chat to know what is being asked.
 *
 * Price, Reservations and Photos each need Stock: every one of them is about
 * a unit on the shelf, and answering any of them says the unit is there. They
 * keep their own setting while Stock is off and are drawn disabled, so
 * turning Stock back on restores what somebody chose.
 *
 * Only the owner can change them (the server says 403 to anybody else); staff
 * see them, because knowing what the bot will and will not answer is what
 * tells them which chats will land on their desk.
 */
import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Modal,
  Select,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  getCapabilities,
  getTesters,
  setCapabilities,
  setTesters,
  type BotCapabilities,
  type BotCapabilitiesState,
} from "../../lib/chatApi.js";
import { useSession } from "../../lib/session.js";

type Key = keyof BotCapabilities;

export function BotSwitches() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const session = useSession();
  const isOwner = session.data?.role === "OWNER";
  const [state, setState] = useState<BotCapabilitiesState | null>(null);
  const [saving, setSaving] = useState<Key | null>(null);
  /** The numbers `/new` is honoured from; null until the server has answered. */
  const [testers, setTesterList] = useState<string[] | null>(null);
  /** The list as being edited in the dialog, or null while it is shut. */
  const [editing, setEditing] = useState<string[] | null>(null);
  const [savingTesters, setSavingTesters] = useState(false);

  useEffect(() => {
    getCapabilities()
      .then(setState)
      .catch(() => setState(null));
    getTesters()
      .then((r) => setTesterList(r.numbers))
      .catch(() => setTesterList(null));
  }, []);

  const saveTesters = async () => {
    if (editing === null) return;
    setSavingTesters(true);
    try {
      setTesterList((await setTesters(editing)).numbers);
      setEditing(null);
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatTesters.saveFailed", "Could not save the tester numbers."),
      );
    } finally {
      setSavingTesters(false);
    }
  };

  const switches: Array<{ key: Key; label: string; hint: string }> = [
    {
      key: "stock",
      label: t("chatSwitch.stock", "Stock"),
      hint: t(
        "chatSwitch.stockHint",
        "Whether a unit is in stock, and its grade.",
      ),
    },
    {
      key: "price",
      label: t("chatSwitch.price", "Price"),
      hint: t(
        "chatSwitch.priceHint",
        "What a unit costs, from the POS. A unit with no price always goes to you.",
      ),
    },
    {
      key: "reserve",
      label: t("chatSwitch.reservations", "Reservations"),
      hint: t(
        "chatSwitch.reservationsHint",
        "Make, check, move and cancel the customer's own booking.",
      ),
    },
    {
      key: "photos",
      label: t("chatSwitch.photos", "Photos"),
      hint: t("chatSwitch.photosHint", "Send the shop's QC photos of a unit."),
    },
  ];

  const flip = async (key: Key, value: boolean) => {
    setSaving(key);
    try {
      setState(await setCapabilities({ [key]: value }));
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : t("chatSwitch.saveFailed", "Could not change that switch."),
      );
    } finally {
      setSaving(null);
    }
  };

  if (!state) return null;

  return (
    <Card size="small">
      <Flex wrap gap={16} align="center">
        <Typography.Text strong>
          {t("chatSwitch.title", "The bot may answer")}
        </Typography.Text>
        {switches.map((s) => {
          const needsStock = s.key !== "stock" && !state.set.stock;
          const reason = !isOwner
            ? t("chatSwitch.ownerOnly", "Only the owner can change this.")
            : needsStock
              ? t("chatSwitch.needsStock", "Needs Stock on.")
              : null;
          return (
            <Tooltip
              key={s.key}
              title={
                <>
                  {s.hint}
                  <br />
                  {state.effective[s.key]
                    ? t(
                        "chatSwitch.onMeans",
                        "On: the bot answers this itself.",
                      )
                    : t(
                        "chatSwitch.offMeans",
                        "Off: it goes to you, with an action item.",
                      )}
                  {reason && (
                    <>
                      <br />
                      {reason}
                    </>
                  )}
                </>
              }
            >
              <Flex align="center" gap={6}>
                <Switch
                  size="small"
                  checked={state.effective[s.key]}
                  disabled={!isOwner || needsStock}
                  loading={saving === s.key}
                  onChange={(v) => void flip(s.key, v)}
                  aria-label={s.label}
                />
                <Typography.Text
                  type={state.effective[s.key] ? undefined : "secondary"}
                >
                  {s.label}
                </Typography.Text>
              </Flex>
            </Tooltip>
          );
        })}
        {testers !== null && (
          <Button
            size="small"
            style={{ marginInlineStart: "auto" }}
            onClick={() => setEditing(testers)}
          >
            {t("chatTesters.button", "Testers ({{n}})", { n: testers.length })}
          </Button>
        )}
      </Flex>

      <Modal
        open={editing !== null}
        title={t("chatTesters.title", "Tester numbers")}
        okText={t("chatTesters.save", "Save")}
        okButtonProps={{ disabled: !isOwner, loading: savingTesters }}
        onOk={() => void saveTesters()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            {t(
              "chatTesters.hint",
              "A tester who sends /new starts their chat over: the bot forgets the earlier messages and any open hand-over on that chat is closed. From any other number /new is an ordinary message.",
            )}
          </Typography.Text>
          <Select
            mode="tags"
            open={false}
            suffixIcon={null}
            disabled={!isOwner}
            value={editing ?? []}
            onChange={(v: string[]) => setEditing(v)}
            tokenSeparators={[",", " ", ";"]}
            placeholder={t(
              "chatTesters.placeholder",
              "0812… or 62812…, then Enter",
            )}
            aria-label={t("chatTesters.title", "Tester numbers")}
            style={{ width: "100%" }}
          />
          {!isOwner && (
            <Typography.Text type="secondary">
              {t("chatSwitch.ownerOnly", "Only the owner can change this.")}
            </Typography.Text>
          )}
        </Flex>
      </Modal>
    </Card>
  );
}
