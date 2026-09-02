-- Staff-editable knobs that do not each warrant a table. First use: the
-- battery-health band thresholds, which Settings must be able to change.
--
-- Two thresholds, not three ranges: the owner's original bands overlapped
-- ("fair 76-79" against "bad below 75%-79%"), which two thresholds make
-- unrepresentable.

CREATE TABLE "AppSetting" (
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES
  ('battery.goodMin', '80', now()),
  ('battery.fairMin', '76', now());

GRANT SELECT, INSERT, UPDATE ON "AppSetting" TO nusantara_app;
GRANT SELECT ON "AppSetting" TO nusantara_agent;
GRANT SELECT ON "AppSetting" TO nusantara_readonly;
