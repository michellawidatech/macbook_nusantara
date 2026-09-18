/**
 * What a staff password and a staff username may be (owner ask 2026-09-18).
 *
 * The app signs people in itself since Auth0 was retired, and the owner's rule
 * is that every account starts on one shared password and replaces it at first
 * sign-in. That makes this file the only thing standing between "replace it"
 * and "replace it with `password1`", so the form that asks and the API that
 * refuses call the same function — a rule written twice is two rules the day
 * one of them is edited.
 *
 * Length and a blocklist, not composition rules (NIST SP 800-63B §5.1.1.2): a
 * shop assistant told "one capital, one digit, one symbol" writes `Password1!`
 * on a sticky note. Eight characters is the floor that guidance sets, and the
 * blocklist is the handful of things people in this shop would actually type.
 */

/**
 * What a new or reset account signs in with, once. Public on purpose — the
 * owner chose it so nobody has to relay a secret — which is exactly why a
 * session on it can do nothing but replace it.
 */
export const INITIAL_PASSWORD = "password";

export const PASSWORD_MIN_LENGTH = 8;
/** Generous; Argon2 hashes any length, and nobody types more than this. */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem =
  | "TOO_SHORT"
  | "TOO_LONG"
  /** The shop's shared starting password, in any capitalisation. */
  | "INITIAL"
  /** The username is in it — the first thing anybody guessing would try. */
  | "HAS_USERNAME"
  /** On the blocklist, or one character repeated. */
  | "TOO_COMMON";

/**
 * Lower-cased. What people reach for first, including the shop's own name and
 * the local favourites that no English list carries.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "12345678",
  "123456789",
  "1234567890",
  "0123456789",
  "87654321",
  "12341234",
  "12121212",
  "11223344",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "asdfghjk",
  "asdf1234",
  "abcd1234",
  "abcdefgh",
  "iloveyou",
  "admin123",
  "admin1234",
  "welcome1",
  "bismillah",
  "bismillah1",
  "bismillah123",
  "indonesia",
  "indonesia1",
  "jakarta123",
  "tangerang",
  "sayang123",
  "katasandi",
  "katasandi123",
  "rahasia123",
  "macbook1",
  "macbook123",
  "applemac",
  "nusantara",
  "nusantara1",
  "nusantara123",
  "macbooknusantara",
]);

/**
 * Why a password may not be used, or null when it may.
 *
 * Length counts characters, not UTF-16 units, so an emoji is one character
 * here the way it is one on the keyboard that typed it.
 */
export function passwordProblem(
  password: string,
  username: string,
): PasswordProblem | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (length > PASSWORD_MAX_LENGTH) return "TOO_LONG";

  const folded = password.toLowerCase();
  if (folded === INITIAL_PASSWORD) return "INITIAL";

  // Three letters or more: a two-letter username is inside half the words in
  // the dictionary, and refusing all of them would be noise, not security.
  const user = username.trim().toLowerCase();
  if (user.length >= 3 && folded.includes(user)) return "HAS_USERNAME";

  if (COMMON_PASSWORDS.has(folded) || /^(.)\1*$/u.test(folded))
    return "TOO_COMMON";
  return null;
}

/**
 * A username: what somebody types on a phone keyboard in a hurry — lower-case
 * letters, digits and `. _ -`, starting with a letter or digit, 2 to 32 long.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/**
 * A username for a person, from their name: the first word, lower-cased and
 * stripped to `USERNAME_PATTERN`, numbered until it is free. "Ersen" becomes
 * `ersen`; a second "Rini" becomes `rini2`; a name with nothing usable in it
 * becomes `staf`, `staf2`…
 */
export function usernameFor(name: string, taken: ReadonlySet<string>): string {
  const first =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .find((w) => w !== "") ?? "";
  // Cut before testing, and to 29 so a two-digit suffix still fits inside the
  // pattern's 32-character ceiling.
  const stripped = first
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 29);
  const base = USERNAME_PATTERN.test(stripped) ? stripped : "staf";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}
