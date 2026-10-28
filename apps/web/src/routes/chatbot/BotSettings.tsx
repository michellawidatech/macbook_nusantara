/**
 * Settings — how the bot is put together.
 *
 * On top: the four "may answer" switches, and for the owner the WhatsApp
 * connection — the linked device that is the shop's number (2026-10-22).
 * Then, reworked 2026-10-28 (owner: *"remove this, but just to set the
 * prompt (can choose & have multiple but 1 is used) and the model used, the
 * usage, CRUD list of testers, CRUD list of alert numbers"*):
 *
 * - **Prompts** — several, one In use (`PromptsCard`).
 * - **Model & usage** — the model the bot runs on, and what it did and cost.
 * - **Testers** and **WhatsApp alerts** — numbers with names
 *   (`NumberListCard`).
 *
 * The Agent card and the simulator that stood here are gone; `Simulator.tsx`
 * and `POST /api/chat/simulate` stay, unused.
 *
 * Every write here is the owner's: the server answers 403 to anybody else,
 * and the controls are drawn for everybody but only the owner's work.
 */
import { Col, Flex, Row } from "antd";
import { useTranslation } from "react-i18next";
import { useSession } from "../../lib/session.js";
import { BotSwitches } from "./BotSwitches.js";
import { WhatsAppConnection } from "./WhatsAppConnection.js";
import { PromptsCard } from "./PromptsCard.js";
import { ModelUsageCard } from "./ModelUsageCard.js";
import { NumberListCard } from "./NumberListCard.js";

export function BotSettings() {
  const { t } = useTranslation();
  const isOwner = useSession().data?.role === "OWNER";

  return (
    <Flex vertical gap={16}>
      <BotSwitches />
      {/* Owner-only: a QR on screen is the shop's number (2026-10-22). */}
      {isOwner && <WhatsAppConnection />}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <PromptsCard isOwner={isOwner} />
        </Col>
        <Col xs={24} xl={12}>
          <ModelUsageCard isOwner={isOwner} />
        </Col>
        <Col xs={24} xl={12}>
          <NumberListCard
            path="/api/chat/notify-numbers"
            title={t("chatNotify.title", "WhatsApp alerts to staff")}
            hint={t(
              "chatNotify.hint2",
              "When a chat needs a person, or the chatbot stops working, the shop's WhatsApp sends these numbers a message. The bot never answers them unless they are also testers.",
            )}
            isOwner={isOwner}
          />
        </Col>
        <Col xs={24} xl={12}>
          <NumberListCard
            path="/api/chat/testers"
            title={t("chatTesters.title", "Tester numbers")}
            hint={t(
              "chatTesters.hint2",
              "A tester who sends /new starts their chat over: the bot forgets the earlier messages.",
            )}
            isOwner={isOwner}
          />
        </Col>
      </Row>
    </Flex>
  );
}
