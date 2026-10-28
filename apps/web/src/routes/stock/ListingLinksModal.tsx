/**
 * A variant's marketplace listings (owner, 2026-10-28) — Shopee, Tokopedia
 * and Instagram. The bot sends one when a customer asks how to buy online.
 *
 * Per VARIANT, not per serial: one Shopee listing usually sells several
 * variants, so the same link may sit on more than one, and every grade and
 * warehouse line of this variant shares what is set here — the dialog says
 * so. `https://` only, as the column's CHECK and the store contract say.
 */
import { useEffect } from "react";
import { Alert, Form, Input, Modal } from "antd";
import { useTranslation } from "react-i18next";
import { mutate, useDb } from "../../mock/store.js";

type Field = "shopeeUrl" | "tokopediaUrl" | "instagramUrl";
const FIELDS: readonly Field[] = ["shopeeUrl", "tokopediaUrl", "instagramUrl"];

/** Empty, or an https address of at most 500 characters. */
export function listingUrlProblem(v: string): "HTTPS" | "LONG" | null {
  const s = v.trim();
  if (s === "") return null;
  if (!/^https:\/\//i.test(s)) return "HTTPS";
  if (s.length > 500) return "LONG";
  return null;
}

export function ListingLinksModal({
  skuId,
  title,
  onClose,
}: {
  readonly skuId: string | null;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const [form] = Form.useForm<Record<Field, string>>();
  const sku = db.skus.find((s) => s.id === skuId);

  useEffect(() => {
    if (!sku) return;
    form.setFieldsValue({
      shopeeUrl: sku.shopeeUrl ?? "",
      tokopediaUrl: sku.tokopediaUrl ?? "",
      instagramUrl: sku.instagramUrl ?? "",
    });
  }, [skuId]);

  const label: Record<Field, string> = {
    shopeeUrl: t("listing.shopee", "Shopee"),
    tokopediaUrl: t("listing.tokopedia", "Tokopedia"),
    instagramUrl: t("listing.instagram", "Instagram"),
  };

  const save = async () => {
    // A refused field is shown under itself; nothing more to do here.
    const v = await form.validateFields().catch(() => null);
    if (v === null) return;
    mutate((d) => {
      const s = d.skus.find((x) => x.id === skuId);
      if (!s) return;
      for (const f of FIELDS) {
        const url = (v[f] ?? "").trim();
        if (url === "") delete s[f];
        else s[f] = url;
      }
    });
    onClose();
  };

  return (
    <Modal
      open={skuId !== null}
      title={t("listing.title", "Listing links — {{what}}", { what: title })}
      okText={t("common.save", "Save")}
      onOk={() => void save()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t(
          "listing.appliesToVariant",
          "These links belong to the variant, so every grade and warehouse of it uses them.",
        )}
      />
      <Form form={form} layout="vertical">
        {FIELDS.map((f) => (
          <Form.Item
            key={f}
            name={f}
            label={label[f]}
            rules={[
              {
                validator: (_, value: string | undefined) => {
                  const p = listingUrlProblem(value ?? "");
                  return p === null
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(
                          p === "HTTPS"
                            ? t(
                                "listing.needsHttps",
                                "A link starts with https://",
                              )
                            : t(
                                "listing.tooLong",
                                "A link is at most 500 characters.",
                              ),
                        ),
                      );
                },
              },
            ]}
          >
            <Input
              placeholder={t("listing.placeholder", "https://…")}
              allowClear
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
