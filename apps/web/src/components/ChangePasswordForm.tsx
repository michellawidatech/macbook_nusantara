/**
 * Choose a new password — the forced first-sign-in screen and Settings → My
 * account both render this, so the rule a person meets is one rule.
 *
 * The rule itself is `passwordProblem` from `@nusantara/domain`, the very
 * function the API runs before it accepts the change (routes/auth.ts). Checking
 * it here as well is only so the person hears about "too short" before a round
 * trip; the server's answer is the one that counts, and its message is shown
 * when it disagrees.
 *
 * Asks for the current password even on the forced screen: a session is a
 * cookie on a shared shop PC, and a cookie alone must not be enough to take an
 * account away from its owner.
 */
import { useState } from "react";
import { Alert, Button, Form, Input, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  type PasswordProblem,
} from "@nusantara/domain";
import { ApiOfflineError, ApiRequestError } from "../lib/api.js";
import { useChangePassword } from "../lib/session.js";

interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

export interface ChangePasswordFormProps {
  readonly username: string;
  /** Called after the server accepted the new password. */
  readonly onChanged?: () => void;
  /** The primary button's text. */
  readonly submitLabel?: string;
}

export function ChangePasswordForm({
  username,
  onChanged,
  submitLabel,
}: ChangePasswordFormProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<Values>();
  const change = useChangePassword();
  const [serverError, setServerError] = useState<string | null>(null);

  // Literal t() calls, one per case, rather than a table indexed by the
  // problem: test/i18n.test.ts finds copy by reading the source, and a lookup
  // table would hide these from it.
  const explain = (problem: PasswordProblem): string => {
    switch (problem) {
      case "TOO_SHORT":
        return t("password.tooShort", "At least {{n}} characters.", {
          n: PASSWORD_MIN_LENGTH,
        });
      case "TOO_LONG":
        return t("password.tooLong", "That is longer than a password can be.");
      case "INITIAL":
        return t(
          "password.initial",
          "That is the shop's starting password. Choose one of your own.",
        );
      case "HAS_USERNAME":
        return t(
          "password.hasUsername",
          "Leave your username out of it — it is the first thing anyone would guess.",
        );
      case "TOO_COMMON":
        return t(
          "password.tooCommon",
          "Too easy to guess. A few words together is easier to remember and harder to guess.",
        );
    }
  };

  const submit = (values: Values) => {
    setServerError(null);
    change.mutate(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => {
          form.resetFields();
          onChanged?.();
        },
        onError: (error) => {
          if (
            error instanceof ApiRequestError &&
            error.field === "currentPassword"
          ) {
            form.setFields([
              {
                name: "currentPassword",
                value: "",
                errors: [
                  t(
                    "password.currentWrong",
                    "That is not your current password.",
                  ),
                ],
              },
            ]);
            return;
          }
          if (
            error instanceof ApiRequestError &&
            error.field === "newPassword"
          ) {
            form.setFields([{ name: "newPassword", errors: [error.message] }]);
            return;
          }
          setServerError(
            error instanceof ApiOfflineError
              ? t(
                  "login.offline",
                  "The server cannot be reached. Check the connection and try again.",
                )
              : error instanceof ApiRequestError && error.status === 429
                ? t(
                    "login.tooMany",
                    "Too many attempts. Wait a few minutes, then try again.",
                  )
                : error.message,
          );
        },
      },
    );
  };

  return (
    <Form<Values>
      form={form}
      layout="vertical"
      onFinish={submit}
      requiredMark={false}
      // The username is invisible, but a password manager needs it to know
      // which saved entry this new password replaces.
      autoComplete="on"
    >
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={username}
        readOnly
        hidden
      />
      {serverError !== null && (
        <Alert
          type="error"
          showIcon
          message={serverError}
          style={{ marginBottom: 16 }}
        />
      )}
      <Form.Item
        name="currentPassword"
        label={t("password.current", "Current password")}
        rules={[
          {
            required: true,
            message: t(
              "password.currentRequired",
              "Type the password you signed in with.",
            ),
          },
        ]}
      >
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label={t("password.new", "New password")}
        extra={
          <Typography.Text type="secondary">
            {t(
              "password.hint",
              "At least {{n}} characters. A short sentence works well.",
              { n: PASSWORD_MIN_LENGTH },
            )}
          </Typography.Text>
        }
        rules={[
          {
            required: true,
            message: t("password.newRequired", "Choose a new password."),
          },
          {
            validator: (_rule, value: string | undefined) => {
              const problem = value ? passwordProblem(value, username) : null;
              return problem === null
                ? Promise.resolve()
                : Promise.reject(new Error(explain(problem)));
            },
          },
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label={t("password.confirm", "Type the new password again")}
        dependencies={["newPassword"]}
        rules={[
          {
            required: true,
            message: t(
              "password.confirmRequired",
              "Type it once more, to be sure.",
            ),
          },
          ({ getFieldValue }) => ({
            validator: (_rule, value: string | undefined) =>
              !value || getFieldValue("newPassword") === value
                ? Promise.resolve()
                : Promise.reject(
                    new Error(
                      t(
                        "password.mismatch",
                        "The two new passwords are different.",
                      ),
                    ),
                  ),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={change.isPending}>
        {submitLabel ?? t("password.save", "Save new password")}
      </Button>
    </Form>
  );
}
