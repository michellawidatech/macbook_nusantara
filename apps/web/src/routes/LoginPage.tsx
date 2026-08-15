/**
 * The login screen — 02 §5 and §12.
 *
 * "A failed login names the reason and keeps the username" (S8's constraint):
 * the username input is never cleared, focus returns to the password field,
 * and the message is the server's own Indonesian text.
 */

import { useRef, useState, type FormEvent } from "react";
import { ApiOfflineError, ApiRequestError } from "../lib/api.js";
import { useI18n } from "../lib/i18n.js";
import { useLogin } from "../lib/session.js";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { t } = useI18n();
  const login = useLogin();

  // Controlled, so a failed attempt cannot lose what was typed.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const message =
    login.error === null || login.error === undefined
      ? null
      : login.error instanceof ApiOfflineError
        ? t("login.offline")
        : login.error instanceof ApiRequestError
          ? login.error.message
          : t("login.failed");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(
      { username, password },
      {
        onError: () => {
          // 02 §3: on a failed submit, focus the first field with an error and
          // announce it. The username is almost always right; the password is
          // the field to retype.
          setPassword("");
          passwordRef.current?.focus();
        },
      },
    );
  };

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t("login.title")}</h1>

        {/* aria-live so the failure is announced without stealing focus. */}
        <div className={styles.messageSlot} role="status" aria-live="polite">
          {message === null ? null : (
            <p className={styles.error} data-testid="login-error">
              {message}
            </p>
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>{t("login.username")}</span>
          <input
            className={styles.input}
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t("login.password")}</span>
          <input
            ref={passwordRef}
            className={styles.input}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button
          type="submit"
          className={styles.submit}
          disabled={login.isPending}
        >
          {login.isPending ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
    </main>
  );
}
