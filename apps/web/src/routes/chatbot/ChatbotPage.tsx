/**
 * The chatbot, in one screen: Chat · Knowledge Base · Evaluation · Settings
 * (owner redesign 2026-10-15). What it said, what it knows to say, how well it
 * said it, and how it is put together.
 *
 * Two nav items until 2026-08-26 (owner decision). Reading a reply that came
 * out wrong and fixing the answer behind it was a trip to another menu item and
 * back, which is precisely the moment the person had the correction in their
 * head. One page with two tabs keeps the two halves a click apart.
 *
 * ## Why this page is `fill` and the tabs are a flex column
 *
 * The inbox is a three-pane layout that manages its own scrolling — chat list,
 * messages, detail — and that only works if every ancestor is height-bounded
 * with `minHeight: 0` the whole way up. Wrapping it in a `Tabs` adds two more
 * ancestors (`.ant-tabs` and `.ant-tabs-content`), and antd sizes neither. Left
 * alone they size to their content, the chain breaks at exactly that point, and
 * the message list grows the page instead of scrolling inside it.
 *
 * So the `Tabs` gets `flex: 1; min-height: 0` and its content holder is made a
 * full-height flex column in `global.css` (`.chatbot-tabs`). Both are needed:
 * the outer one so the tab strip's siblings can be bounded, the inner one so
 * the active pane inherits that bound.
 *
 * The other three tabs are ordinary pages, so each is wrapped in a box that
 * scrolls — the frame itself never does.
 */
import { useState, type ReactNode } from "react";
import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageContainer } from "../../components/PageContainer";
import { ChatInbox } from "./ChatPage";
import { KnowledgePanel } from "./KnowledgePage";
import { EvaluationPanel } from "./EvaluationPanel";
import { BotSettings } from "./BotSettings";
import { useSession } from "../../lib/session.js";

type TabKey = "chat" | "knowledge" | "evaluation" | "settings";

/** A tab that is an ordinary page: it scrolls inside the fill frame. */
function Scrolling({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
  );
}

export function ChatbotPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("chat");
  /*
   * The open thread lives here rather than in the inbox, so the Evaluation
   * tab's "Open chat" can switch tabs AND open the conversation in one press.
   */
  // "Open chat" on a reservation request (2026-10-27) arrives with the
  // number in the navigation STATE — nothing navigates from an effect.
  const location = useLocation();
  // Or in the address — the sidebar's "chats need a reply" and a staff
  // WhatsApp alert both link to /chat?phone=… (2026-10-28).
  const [params] = useSearchParams();
  const linked = params.get("phone");
  const [picked, setPicked] = useState<string | null>(
    () =>
      linked ??
      (location.state as { openPhone?: string } | null)?.openPhone ??
      null,
  );
  // A second press while already here: open that chat on the Chat tab. Set
  // from the address the render it changed in, not from an effect.
  const [lastLinked, setLastLinked] = useState(linked);
  if (linked !== lastLinked) {
    setLastLinked(linked);
    if (linked) {
      setPicked(linked);
      setTab("chat");
    }
  }
  // Delete conversation is offered to the owner; the server checks again.
  const isOwner = useSession().data?.role === "OWNER";

  return (
    <PageContainer title="Chatbot" fill>
      <Tabs
        className="chatbot-tabs"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        // Mounted lazily and kept mounted afterwards. The inbox polls and holds
        // a scroll position; destroying it on every tab change would restart
        // the poll and throw the reader back to the newest message.
        destroyOnHidden={false}
        style={{ flex: 1, minHeight: 0 }}
        items={[
          {
            key: "chat",
            label: t("chatbot.chat", "Chat"),
            children: (
              <ChatInbox picked={picked} onPick={setPicked} isOwner={isOwner} />
            ),
          },
          {
            key: "knowledge",
            label: t("chatbot.knowledgeBase", "Knowledge Base"),
            children: (
              <Scrolling>
                <KnowledgePanel />
              </Scrolling>
            ),
          },
          {
            key: "evaluation",
            label: t("chatbot.evaluation", "Evaluation"),
            children: (
              <Scrolling>
                <EvaluationPanel
                  onOpenChat={(phone) => {
                    setPicked(phone);
                    setTab("chat");
                  }}
                />
              </Scrolling>
            ),
          },
          {
            key: "settings",
            label: t("chatbot.settings", "Settings"),
            children: (
              <Scrolling>
                <BotSettings />
              </Scrolling>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
