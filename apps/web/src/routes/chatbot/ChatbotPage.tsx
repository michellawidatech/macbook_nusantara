/**
 * The chatbot, in one screen: what it said, and what it knows to say.
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
 * The Knowledge tab does not need any of this and is unharmed by it — an
 * ordinary table in a full-height box is still an ordinary table.
 */
import { useState } from "react";
import { Tabs } from "antd";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { ChatInbox } from "./ChatPage";
import { KnowledgePanel } from "./KnowledgePage";

type TabKey = "inbox" | "knowledge";

export function ChatbotPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("inbox");

  return (
    <PageContainer title="Chatbot" fill>
      <Tabs
        className="chatbot-tabs"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        // Mounted lazily and kept mounted afterwards. The inbox polls and holds
        // a scroll position; destroying it on every tab change would restart
        // the poll and throw the reader back to the newest message. Not
        // mounting Knowledge until it is first opened keeps that cost off the
        // page load, which is the inbox's.
        destroyOnHidden={false}
        style={{ flex: 1, minHeight: 0 }}
        items={[
          {
            key: "inbox",
            label: t("chatbot.inbox", "Chat Inbox"),
            children: <ChatInbox />,
          },
          {
            key: "knowledge",
            label: t("chatbot.knowledge", "Knowledge"),
            children: <KnowledgePanel />,
          },
        ]}
      />
    </PageContainer>
  );
}
