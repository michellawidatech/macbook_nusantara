import { Button, Card, Flex, Typography } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { BrandMark } from "../components/BrandMark.js";
import { ChangePasswordForm } from "../components/ChangePasswordForm.js";
import { useLogout, type Staff } from "../lib/session.js";
import { SPACE } from "../theme/tokens";

/**
 * The first sign-in (owner ask 2026-09-18): "in the first time login need to
 * change their password".
 *
 * Shown INSTEAD of the app, not over it — there is nothing behind it this
 * session could use anyway, because the API answers every business route with
 * 403 GANTI_SANDI until the change is made (auth/middleware.ts). Signing out is
 * the one other thing on offer, for the person who sat down at somebody
 * else's session.
 */
export function ChangePasswordPage({ staff }: { staff: Staff }) {
  const { t } = useTranslation();
  const logout = useLogout();

  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: "100vh", padding: SPACE.md }}
    >
      <Card style={{ width: "100%", maxWidth: 420 }}>
        <Flex align="center" gap={SPACE.sm} style={{ marginBottom: SPACE.sm }}>
          <BrandMark size={32} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("password.chooseTitle", "Choose your own password")}
          </Typography.Title>
        </Flex>
        <Typography.Paragraph type="secondary">
          {t(
            "password.chooseIntro",
            "Hi {{name}}. You signed in with a password somebody else set, so other people may know it. Choose your own before you continue.",
            { name: staff.name },
          )}
        </Typography.Paragraph>
        <ChangePasswordForm
          username={staff.username}
          submitLabel={t("password.saveAndContinue", "Save and continue")}
        />
        <Button
          type="link"
          icon={<LogoutOutlined />}
          onClick={() => logout.mutate()}
          loading={logout.isPending}
          style={{ marginTop: SPACE.sm, paddingInline: 0 }}
        >
          {t("account.signOut", "Sign out")}
        </Button>
      </Card>
    </Flex>
  );
}
