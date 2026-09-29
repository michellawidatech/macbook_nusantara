import { useRef, useState } from "react";
import { Alert, Button, Card, Flex, Form, Input, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import type { InputRef } from "antd";
import { useTranslation } from "react-i18next";
import { BrandMark } from "../components/BrandMark.js";
import { ApiOfflineError, ApiRequestError } from "../lib/api.js";
import { useLogin } from "../lib/session.js";
import { SPACE } from "../theme/tokens";

/**
 * Sign in — the app's own, since Auth0 was retired (owner ask 2026-09-18).
 *
 * "A failed login names the reason and keeps the username" (S8's constraint,
 * which this screen had before Auth0 and has again): the username is never
 * cleared, the password is, and focus goes back to it — the username is almost
 * always right and the password is the field to retype.
 *
 * Every failure reads the same ("wrong username or password") because the API
 * answers every failure the same; saying which half was wrong would tell a
 * stranger which usernames exist.
 *
 * The username box does not capitalise or autocorrect: a phone keyboard
 * turning `ersen` into `Ersen` is the most common way to fail here. The API
 * forgives the capital anyway (routes/auth.ts `findForLogin`).
 *
 * There is deliberately no language switch here. It lives in the account menu,
 * and nobody picks a language before they have signed in.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const login = useLogin();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const passwordRef = useRef<InputRef>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (values: { username: string; password: string }) => {
    setError(null);
    login.mutate(
      { username: values.username.trim(), password: values.password },
      {
        onError: (e) => {
          setError(
            e instanceof ApiOfflineError
              ? t(
                  "login.offline",
                  "The server cannot be reached. Check the connection and try again.",
                )
              : e instanceof ApiRequestError && e.status === 429
                ? t(
                    "login.tooMany",
                    "Too many attempts. Wait a few minutes, then try again.",
                  )
                : e instanceof ApiRequestError && e.status === 401
                  ? t("login.wrong", "Wrong username or password.")
                  : e.message,
          );
          form.setFieldValue("password", "");
          passwordRef.current?.focus();
        },
      },
    );
  };

  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: "100vh", padding: SPACE.md }}
    >
      <Card style={{ width: "100%", maxWidth: 380 }}>
        <Flex align="center" gap={SPACE.sm} style={{ marginBottom: SPACE.sm }}>
          <BrandMark size={32} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("app.name", "Macbook Nusantara")}
          </Typography.Title>
        </Flex>
        <Typography.Paragraph type="secondary">
          {t("login.subtitle", "Sign in with your staff account.")}
        </Typography.Paragraph>

        {/* aria-live so the failure is announced without stealing focus. */}
        <div role="status" aria-live="polite">
          {error !== null && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: SPACE.md }}
            />
          )}
        </div>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={submit}
        >
          <Form.Item
            name="username"
            label={t("login.username", "Username")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("login.usernameRequired", "Type your username."),
              },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("login.password", "Password")}
            rules={[
              {
                required: true,
                message: t("login.passwordRequired", "Type your password."),
              },
            ]}
          >
            <Input.Password
              ref={passwordRef}
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={login.isPending}
          >
            {t("login.signIn", "Sign in")}
          </Button>
        </Form>

        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: SPACE.md, marginBottom: 0 }}
        >
          {t(
            "login.forgot",
            "Forgot your password? Ask the owner to reset it from Settings → Staff accounts.",
          )}
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}
