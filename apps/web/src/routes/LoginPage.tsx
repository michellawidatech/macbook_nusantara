import { Button, Card, Flex, Typography } from "antd";
import { LoginOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

/**
 * Sign in.
 *
 * Auth0 owns the credentials now, so there is no form here: the button is a
 * plain link that leaves the SPA. It has to be a full page navigation rather
 * than a fetch — the OIDC flow is a chain of top-level redirects through the
 * tenant and back, and XHR cannot follow it.
 *
 * `/auth/login` is proxied to the API in development (apps/web/vite.config.ts)
 * and served by the same origin in production, which is what keeps the session
 * cookie same-origin.
 *
 * There is deliberately no language switch here. It lives in the account menu,
 * and nobody picks a language before they have signed in.
 */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {t("app.name", "Macbook Nusantara")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("login.subtitle", "Sign in with your staff account.")}
        </Typography.Paragraph>
        <Button
          type="primary"
          icon={<LoginOutlined />}
          block
          href="/auth/login"
        >
          {t("login.signIn", "Sign in")}
        </Button>
      </Card>
    </Flex>
  );
}
