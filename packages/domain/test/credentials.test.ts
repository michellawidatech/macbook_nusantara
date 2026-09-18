import { describe, expect, it } from "vitest";
import {
  INITIAL_PASSWORD,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  passwordProblem,
  usernameFor,
} from "../src/credentials.js";

describe("passwordProblem", () => {
  it("accepts an ordinary passphrase", () => {
    expect(passwordProblem("kopi susu gula aren", "ersen")).toBeNull();
    expect(passwordProblem("Tangerang#2026", "ersen")).toBeNull();
  });

  it("refuses anything shorter than the floor, counting characters not bytes", () => {
    expect(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1), "x")).toBe(
      "TOO_SHORT",
    );
    // Seven emoji are fourteen UTF-16 units and still seven characters.
    expect(passwordProblem("🍎".repeat(7), "x")).toBe("TOO_SHORT");
    expect(passwordProblem("🍎🍏🍐🍊🍋🍌🍉🍇", "x")).toBeNull();
  });

  it("refuses anything longer than the ceiling", () => {
    expect(passwordProblem("ab".repeat(PASSWORD_MAX_LENGTH), "x")).toBe(
      "TOO_LONG",
    );
    expect(
      passwordProblem(`${"xy".repeat(PASSWORD_MAX_LENGTH / 2)}`, "x"),
    ).toBeNull();
  });

  it("refuses the shop's initial password in any capitalisation", () => {
    expect(passwordProblem(INITIAL_PASSWORD, "ersen")).toBe("INITIAL");
    expect(passwordProblem("PassWord", "ersen")).toBe("INITIAL");
  });

  it("refuses a password with the username in it", () => {
    expect(passwordProblem("ersen2026!", "ersen")).toBe("HAS_USERNAME");
    expect(passwordProblem("my-ERSEN-pass", " Ersen ")).toBe("HAS_USERNAME");
  });

  it("does not police a username too short to be a guess", () => {
    expect(passwordProblem("banana-bread", "an")).toBeNull();
  });

  it("refuses the blocklist and a single repeated character", () => {
    expect(passwordProblem("12345678", "ersen")).toBe("TOO_COMMON");
    expect(passwordProblem("Bismillah123", "ersen")).toBe("TOO_COMMON");
    expect(passwordProblem("MacbookNusantara", "ersen")).toBe("TOO_COMMON");
    expect(passwordProblem("zzzzzzzzzz", "ersen")).toBe("TOO_COMMON");
  });
});

describe("usernameFor", () => {
  const none = new Set<string>();

  it("takes the first word of the name, lower-cased", () => {
    expect(usernameFor("Ersen", none)).toBe("ersen");
    expect(usernameFor("  Dimas Pratama ", none)).toBe("dimas");
  });

  it("folds accents and drops what a username may not hold", () => {
    expect(usernameFor("Élma", none)).toBe("elma");
    expect(usernameFor("O'Neil", none)).toBe("oneil");
    expect(usernameFor("-Rini", none)).toBe("rini");
  });

  it("numbers a name that is already taken", () => {
    expect(usernameFor("Rini", new Set(["rini"]))).toBe("rini2");
    expect(usernameFor("Rini", new Set(["rini", "rini2"]))).toBe("rini3");
  });

  it("falls back to staf when nothing usable is left", () => {
    expect(usernameFor("", none)).toBe("staf");
    expect(usernameFor("李", none)).toBe("staf");
    expect(usernameFor("A", none)).toBe("staf");
    expect(usernameFor("", new Set(["staf"]))).toBe("staf2");
  });

  it("always produces something the pattern accepts", () => {
    const long = usernameFor("Abcdefghijklmnopqrstuvwxyzabcdefghij", none);
    expect(long).toHaveLength(29);
    expect(USERNAME_PATTERN.test(long)).toBe(true);
    expect(
      USERNAME_PATTERN.test(
        usernameFor(
          "Abcdefghijklmnopqrstuvwxyzabc",
          new Set(["abcdefghijklmnopqrstuvwxyzabc"]),
        ),
      ),
    ).toBe(true);
  });
});
