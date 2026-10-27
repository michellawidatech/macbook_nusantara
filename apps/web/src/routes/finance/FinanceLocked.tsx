/**
 * What a Financial & Report address shows to an account without
 * `canViewFinance` (owner ask 2026-10-16: "only Ersen and Dina"). The menu
 * does not offer these pages to them; this is for a bookmark or a pasted link.
 * The API sends such an account none of the money either way.
 */
import { Result } from "antd";
import { useTranslation } from "react-i18next";

export function FinanceLocked() {
  const { t } = useTranslation();
  return (
    <Result
      status="403"
      title={t("finance.lockedTitle", "Financial & Report is restricted")}
      subTitle={t(
        "finance.lockedBody",
        "Ask the owner to switch on finance access for your account in Settings → Staff accounts.",
      )}
    />
  );
}
