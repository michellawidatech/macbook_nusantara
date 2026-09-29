/**
 * The store's front door — between the shell and every page.
 *
 * Since 2026-09-13 the store is the browser's copy of PostgreSQL
 * (docs/store-on-postgres.md), so a page has nothing to show until the first
 * load lands. This sits inside `AppLayout`, around the page and not around the
 * shell, for the reason the `ErrorBoundary` beside it does: the sidebar, the
 * account menu and sign-out stay usable while the shop loads, or when it
 * cannot.
 *
 * It also shows the two things the store cannot show on its own, because the
 * store lives outside React and a toast must not be raised from outside a
 * component (CLAUDE.md): a commit the server refused, and a connection that
 * dropped with changes still waiting.
 */
import { useEffect, type ReactNode } from "react";
import { Alert, App, Button, Flex, Result, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  loadStore,
  onStoreError,
  setStoreStaff,
  useStoreStatus,
} from "../mock/store.js";

export function StoreGate({
  staffName,
  children,
}: {
  staffName: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const status = useStoreStatus();

  useEffect(() => {
    setStoreStaff(staffName);
  }, [staffName]);

  useEffect(() => {
    void loadStore();
  }, []);

  useEffect(
    () =>
      onStoreError((reason) => {
        message.error(
          t("store.notSaved", "Not saved — {{reason}}", { reason }),
        );
      }),
    [message, t],
  );

  if (status.phase === "error") {
    return (
      <Result
        status="warning"
        title={t("store.loadFailed", "The shop's data could not be loaded")}
        subTitle={status.error}
        extra={
          <Button type="primary" onClick={() => void loadStore()}>
            {t("store.retry", "Try again")}
          </Button>
        }
      />
    );
  }

  if (status.phase !== "ready") {
    return (
      <Flex vertical align="center" gap={12} style={{ padding: 48 }}>
        <Spin />
        <Typography.Text type="secondary">
          {t("store.loading", "Loading the shop…")}
        </Typography.Text>
      </Flex>
    );
  }

  return (
    <>
      {status.offline && (
        <Alert
          type="warning"
          banner
          style={{ marginBottom: 12 }}
          title={t(
            "store.offline",
            "Offline — {{count}} change(s) waiting to be saved. They are kept, and sent as soon as the connection is back.",
            { count: status.pending },
          )}
        />
      )}
      {children}
    </>
  );
}
