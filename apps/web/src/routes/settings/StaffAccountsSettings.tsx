/**
 * Settings → Staff accounts — the owner's screen (owner ask 2026-09-18:
 * "Ersen can manage all the password account").
 *
 * Who can sign in, as what, and a way back in for anybody who forgot their
 * password. Everything here is enforced again by `/api/staff`, owner-only per
 * endpoint; this tab not being drawn for a cashier is a courtesy.
 *
 * The owner never sees or types anybody's password. A new account and a reset
 * both put the person on the shop's initial password, and the API makes them
 * choose their own at the next sign-in — so the one secret the owner is told is
 * the one that stops working the moment it is used.
 *
 * Nothing is deleted: an account is named by every sale and every stock
 * movement its owner made. Switching it off ends its sessions at once.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { KeyOutlined, PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  INITIAL_PASSWORD,
  USERNAME_PATTERN,
  usernameFor,
} from "@nusantara/domain";
import { DataTable } from "../../components/DataTable";
import { ApiRequestError } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import type { Staff } from "../../lib/session.js";
import {
  useCreateAccount,
  useResetPassword,
  useStaffAccounts,
  useUpdateAccount,
  type StaffAccount,
} from "../../lib/staffApi.js";
import { SPACE } from "../../theme/tokens";

interface CreateValues {
  name: string;
  username: string;
  role: "OWNER" | "STAFF";
}

export function StaffAccountsSettings({ me }: { me: Staff }) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const accounts = useStaffAccounts();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const reset = useResetPassword();
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm<CreateValues>();
  /** Until somebody types in the username box, it follows the name. */
  const [usernameTouched, setUsernameTouched] = useState(false);

  const taken = new Set((accounts.data ?? []).map((a) => a.username));

  const failed = (error: Error) =>
    message.error(
      error instanceof ApiRequestError
        ? error.message
        : t("staff.failed", "That did not save. Try again."),
    );

  const told = (who: StaffAccount) =>
    modal.info({
      title: t("staff.toldTitle", "Tell {{name}} how to sign in", {
        name: who.name,
      }),
      content: (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {t(
            "staff.toldBody",
            "Username {{username}}, password {{password}}. They will be asked to choose their own password as soon as they sign in, and the one above stops working then.",
            { username: who.username, password: INITIAL_PASSWORD },
          )}
        </Typography.Paragraph>
      ),
    });

  const confirmReset = (who: StaffAccount) =>
    modal.confirm({
      title: t("staff.resetTitle", "Reset {{name}}'s password?", {
        name: who.name,
      }),
      content: t(
        "staff.resetBody",
        "They are signed out everywhere, and sign in next with the shop's starting password — then they must choose a new one.",
      ),
      okText: t("staff.resetOk", "Reset password"),
      onOk: () =>
        reset.mutateAsync(who.id).then(
          () => {
            told(who);
          },
          (e: Error) => {
            failed(e);
          },
        ),
    });

  const setActive = (who: StaffAccount, active: boolean) => {
    const run = () =>
      update.mutateAsync({ id: who.id, active }).catch((e: Error) => failed(e));
    if (active) return void run();
    modal.confirm({
      title: t("staff.deactivateTitle", "Switch off {{name}}?", {
        name: who.name,
      }),
      content: t(
        "staff.deactivateBody",
        "They are signed out at once and cannot sign in again until the account is switched back on. Their sales and stock movements stay exactly as they are.",
      ),
      okText: t("staff.deactivateOk", "Switch off"),
      okButtonProps: { danger: true },
      onOk: run,
    });
  };

  const status = (a: StaffAccount) => {
    if (!a.active) return <Tag>{t("staff.statusOff", "Switched off")}</Tag>;
    if (!a.hasPassword)
      return (
        <Tag color="red">{t("staff.statusNoPassword", "No password yet")}</Tag>
      );
    if (a.mustChangePassword)
      return (
        <Tooltip
          title={t(
            "staff.statusWaitingHint",
            "Still on the shop's starting password. It changes the first time they sign in.",
          )}
        >
          <Tag color="gold">
            {t("staff.statusWaiting", "Waiting for first sign-in")}
          </Tag>
        </Tooltip>
      );
    return <Tag color="green">{t("staff.statusActive", "Active")}</Tag>;
  };

  return (
    <Card
      title={t("staff.title", "Staff accounts")}
      extra={
        <Button
          type="primary"
          icon={<UserAddOutlined />}
          onClick={() => {
            form.resetFields();
            setUsernameTouched(false);
            setAdding(true);
          }}
        >
          {t("staff.add", "Add account")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {t(
          "staff.intro",
          "Who can sign in. A new account, or one you reset, starts on the shop's starting password and must choose its own at the first sign-in — you never need to know anybody's password.",
        )}
      </Typography.Paragraph>

      <DataTable<StaffAccount>
        rowKey="id"
        loading={accounts.isPending}
        dataSource={accounts.data ?? []}
        paginated={false}
        columns={[
          {
            title: t("staff.name", "Name"),
            key: "name",
            render: (_, a) => (
              <Flex vertical>
                <Typography.Text
                  strong
                  editable={
                    a.active
                      ? {
                          tooltip: t("staff.rename", "Rename"),
                          onChange: (name) => {
                            const clean = name.trim();
                            if (!clean || clean === a.name) return;
                            update
                              .mutateAsync({ id: a.id, name: clean })
                              .catch((e: Error) => failed(e));
                          },
                        }
                      : false
                  }
                >
                  {a.name}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  copyable={{ text: a.username }}
                >
                  {a.username}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("staff.role", "Role"),
            key: "role",
            render: (_, a) => (
              <Select<"OWNER" | "STAFF">
                size="small"
                value={a.role}
                disabled={a.id === me.id || !a.active}
                style={{ width: 120 }}
                options={[
                  { value: "OWNER", label: t("staff.owner", "Owner") },
                  { value: "STAFF", label: t("staff.staff", "Staff") },
                ]}
                onChange={(role) =>
                  update
                    .mutateAsync({ id: a.id, role })
                    .catch((e: Error) => failed(e))
                }
              />
            ),
          },
          {
            title: t("staff.canApprove", "Can approve"),
            key: "canApprove",
            render: (_, a) => (
              <Tooltip
                title={
                  a.role === "OWNER"
                    ? t("staff.ownerApproves", "An owner always approves.")
                    : t(
                        "staff.canApproveHint",
                        "Approves prices below cost and other decisions that need a second person.",
                      )
                }
              >
                <Switch
                  size="small"
                  checked={a.canApprove}
                  disabled={a.role === "OWNER" || !a.active}
                  onChange={(canApprove) =>
                    update
                      .mutateAsync({ id: a.id, canApprove })
                      .catch((e: Error) => failed(e))
                  }
                />
              </Tooltip>
            ),
          },
          {
            title: t("staff.status", "Status"),
            key: "status",
            render: (_, a) => status(a),
          },
          {
            title: t("staff.lastSignIn", "Last sign-in"),
            key: "lastLoginAt",
            render: (_, a) =>
              a.lastLoginAt ? (
                fmtDateTime(a.lastLoginAt)
              ) : (
                <Typography.Text type="secondary">
                  {t("staff.never", "Never")}
                </Typography.Text>
              ),
          },
          {
            title: t("staff.actions", "Actions"),
            key: "actions",
            render: (_, a) =>
              a.id === me.id ? (
                <Typography.Text type="secondary">
                  {t(
                    "staff.you",
                    "You — change your own password under My account",
                  )}
                </Typography.Text>
              ) : (
                <Flex gap={SPACE.sm} align="center" wrap>
                  <Button
                    size="small"
                    icon={<KeyOutlined />}
                    disabled={!a.active}
                    onClick={() => confirmReset(a)}
                  >
                    {t("staff.reset", "Reset password")}
                  </Button>
                  <Switch
                    size="small"
                    checked={a.active}
                    checkedChildren={t("staff.on", "On")}
                    unCheckedChildren={t("staff.off", "Off")}
                    aria-label={t("staff.activeLabel", "Can sign in")}
                    onChange={(on) => setActive(a, on)}
                  />
                </Flex>
              ),
          },
        ]}
      />

      <Modal
        open={adding}
        title={t("staff.addTitle", "Add an account")}
        okText={t("staff.addOk", "Add account")}
        okButtonProps={{ icon: <PlusOutlined />, loading: create.isPending }}
        onCancel={() => setAdding(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form<CreateValues>
          form={form}
          layout="vertical"
          initialValues={{ role: "STAFF" }}
          onValuesChange={(changed: Partial<CreateValues>) => {
            if (changed.name !== undefined && !usernameTouched)
              form.setFieldValue(
                "username",
                changed.name.trim() ? usernameFor(changed.name, taken) : "",
              );
          }}
          onFinish={(values) =>
            create
              .mutateAsync({
                name: values.name.trim(),
                username: values.username.trim().toLowerCase(),
                role: values.role,
                canApprove: values.role === "OWNER",
              })
              .then(
                ({ account }) => {
                  setAdding(false);
                  told(account);
                },
                (e: Error) => {
                  if (e instanceof ApiRequestError && e.field === "username")
                    form.setFields([{ name: "username", errors: [e.message] }]);
                  else failed(e);
                },
              )
          }
        >
          <Form.Item
            name="name"
            label={t("staff.name", "Name")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("form.nameThem", "Name them"),
              },
            ]}
          >
            <Input autoFocus maxLength={80} />
          </Form.Item>
          <Form.Item
            name="username"
            label={t("staff.username", "Username")}
            extra={t(
              "staff.usernameHint",
              "What they type to sign in: lower-case letters and numbers, no spaces.",
            )}
            rules={[
              {
                required: true,
                message: t("staff.usernameRequired", "Choose a username."),
              },
              {
                validator: (_rule, value: string | undefined) => {
                  const v = (value ?? "").trim().toLowerCase();
                  if (!v) return Promise.resolve();
                  if (!USERNAME_PATTERN.test(v))
                    return Promise.reject(
                      new Error(
                        t(
                          "staff.usernameShape",
                          "2 to 32 characters: letters, numbers, dot, dash or underscore.",
                        ),
                      ),
                    );
                  if (taken.has(v))
                    return Promise.reject(
                      new Error(
                        t(
                          "staff.usernameTaken",
                          "Somebody already has that username.",
                        ),
                      ),
                    );
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              onChange={() => setUsernameTouched(true)}
            />
          </Form.Item>
          <Form.Item name="role" label={t("staff.role", "Role")}>
            <Select
              options={[
                { value: "STAFF", label: t("staff.staff", "Staff") },
                { value: "OWNER", label: t("staff.owner", "Owner") },
              ]}
            />
          </Form.Item>
          <Typography.Text type="secondary">
            {t(
              "staff.addFooter",
              "They start on the shop's starting password ({{password}}) and choose their own at the first sign-in.",
              { password: INITIAL_PASSWORD },
            )}
          </Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}
