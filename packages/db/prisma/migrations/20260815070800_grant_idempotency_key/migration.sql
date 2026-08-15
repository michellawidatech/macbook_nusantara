-- Grants for the table added by 20260815065259_add_idempotency_key.
--
-- S2 deliberately did NOT set ALTER DEFAULT PRIVILEGES for the app and agent
-- roles, so a future append-only table cannot silently inherit UPDATE. The cost
-- of that choice is this file: every migration that creates a table must grant
-- on it explicitly, or the API gets 42501 the first time it writes.
GRANT SELECT, INSERT, UPDATE ON "IdempotencyKey" TO nusantara_app, nusantara_agent;
GRANT SELECT ON "IdempotencyKey" TO nusantara_readonly;
REVOKE DELETE, TRUNCATE ON "IdempotencyKey"
  FROM nusantara_app, nusantara_agent, nusantara_readonly;
