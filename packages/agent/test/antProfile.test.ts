/**
 * A Console login (`ant auth login`) runs the bot without a key in any
 * settings file (owner, 2026-10-22). The profile is found from the PASSED
 * environment, like every other credential here, so a test that passes no
 * `HOME` can never pick up a developer's own login.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anthropicClient,
  antProfileOf,
  hasCredential,
  readAnthropicEnv,
} from "../src/anthropic.js";

let home: string;
const profileDir = () => join(home, ".config", "anthropic");
function login(name = "default") {
  mkdirSync(join(profileDir(), "configs"), { recursive: true });
  writeFileSync(join(profileDir(), "configs", `${name}.json`), "{}");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ant-profile-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("an ant auth login profile", () => {
  it("is a credential when nothing else is set", () => {
    login();
    const env = readAnthropicEnv({ HOME: home });
    expect(env.profile).toBe("default");
    expect(hasCredential(env)).toBe(true);
    expect(anthropicClient(env)).not.toBeNull();
  });

  it("follows active_config and ANTHROPIC_PROFILE, as the SDK does", () => {
    login("shop");
    writeFileSync(join(profileDir(), "active_config"), "shop\n");
    expect(antProfileOf({ HOME: home })).toBe("shop");
    login("other");
    expect(antProfileOf({ HOME: home, ANTHROPIC_PROFILE: "other" })).toBe(
      "other",
    );
    expect(antProfileOf({ ANTHROPIC_CONFIG_DIR: profileDir() })).toBe("shop");
  });

  it("is not used while a key is set, and a template placeholder is not a key", () => {
    login();
    expect(
      readAnthropicEnv({ HOME: home, ANTHROPIC_API_KEY: "sk-ant-x" }).profile,
    ).toBeUndefined();
    const placeholder = readAnthropicEnv({
      HOME: home,
      ANTHROPIC_API_KEY: "CHANGE_ME",
    });
    expect(placeholder.apiKey).toBeUndefined();
    expect(placeholder.profile).toBe("default");
  });

  it("is nothing without a login on disk, or without a HOME at all", () => {
    expect(hasCredential(readAnthropicEnv({ HOME: home }))).toBe(false);
    expect(hasCredential(readAnthropicEnv({}))).toBe(false);
    expect(anthropicClient(readAnthropicEnv({}))).toBeNull();
  });
});
