#!/usr/bin/env node
/**
 * A sealed release for the shop's Mac mini. docs/deploy-macmini.md is the
 * runbook; this is the step that keeps the source on this machine.
 *
 *     node deploy/macmini/build-release.mjs
 *
 * CI runs the same script on GitHub's Apple silicon runner when a v* tag is
 * pushed (docs/deploy-pipeline.md), with NUSANTARA_VERSION set to the tag and
 * the commit — so the release is named for what it is, not for when it was
 * built — and there a tree with uncommitted changes is refused outright.
 *
 * What goes in: the server processes (api, worker, webhook, the WhatsApp
 * gateway) and the CLIs, each compiled by esbuild into ONE minified file; the SPA exactly as
 * `vite build` emits it; a Prisma client generated from a copy of the schema
 * with every comment removed; the two native pieces (Prisma's query engine and
 * argon2) as binaries; and the ops scripts in ./ops.
 *
 * What stays out: every .ts file, every docblock, the tests, git history,
 * CLAUDE.md and the source maps. The maps ARE produced — a minified stack
 * trace is unreadable without one — but they go to build/macmini/maps/<version>
 * on THIS machine and are never packed. Keep them: they are how a crash report
 * from the shop gets read.
 *
 * Output: build/macmini/nusantara-<version>.tar.gz (`build/` is gitignored).
 *
 * ⚠️ The native binaries are built for this machine's CPU. Build on Apple
 * Silicon for an Apple Silicon Mac mini; `ops/run` refuses to start on a
 * different architecture rather than failing inside dlopen.
 */

import { execFileSync } from "node:child_process";
import console from "node:console";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NUSANTARA_ROOT ?? join(HERE, "..", "..");
const OUT = process.env.NUSANTARA_OUT ?? join(ROOT, "build", "macmini");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
const read = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

// esbuild is not a dependency of the workspace root, but tsx (which is) ships
// one — resolving through it avoids a lockfile change for a build script.
const rootRequire = createRequire(join(ROOT, "package.json"));
const esbuild = createRequire(rootRequire.resolve("tsx/package.json"))(
  "esbuild",
);

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const sha = read("git", ["rev-parse", "--short", "HEAD"]);
const changes = read("git", ["status", "--porcelain"]);
const dirty = changes !== "";
// A release CI builds is deployed because of the tag it is named for. One that
// quietly carried something the tag does not would be a release nobody can
// rebuild or read the source of.
if (process.env.CI && dirty) {
  throw new Error(
    `refusing to build a release in CI from a changed tree:\n${changes}`,
  );
}
const builtAt = new Date();
const two = (n) => String(n).padStart(2, "0");
// Local time, because it is read by a person standing at the Mac mini.
const stamp =
  `${builtAt.getFullYear()}${two(builtAt.getMonth() + 1)}${two(builtAt.getDate())}` +
  `-${two(builtAt.getHours())}${two(builtAt.getMinutes())}`;
const version =
  process.env.NUSANTARA_VERSION ?? `${stamp}-${sha}${dirty ? "-dirty" : ""}`;
// It becomes a directory name on the Mac mini, and ops/nusantara-deploy
// refuses anything outside this alphabet.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(version)) {
  throw new Error(`not a usable release version: ${version}`);
}
const name = `nusantara-${version}`;
const stageRoot = join(OUT, "stage");
const stage = join(stageRoot, name);
const arch = read("uname", ["-m"]);

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
console.log(`\n▸ building ${name} for ${arch}\n`);

// ---------------------------------------------------------------------------
// 1. A Prisma client generated from a comment-free schema
//
// The generated client inlines the schema text verbatim, so every docblock in
// schema.prisma would otherwise ship inside app/prisma/index.js. Generated
// under packages/db so `prisma generate` finds @prisma/client the way it
// always does; `build/` is gitignored at any depth.
// ---------------------------------------------------------------------------

const genRoot = join(ROOT, "packages", "db", "build", "release");
rmSync(genRoot, { recursive: true, force: true });
mkdirSync(join(genRoot, "prisma"), { recursive: true });

const schema = stripSchemaComments(
  readFileSync(join(ROOT, "packages", "db", "prisma", "schema.prisma"), "utf8"),
).replace(/output\s*=\s*"[^"]*"/, 'output = "../client"');
if (!schema.includes('output = "../client"')) {
  throw new Error("schema.prisma has no generator output line to redirect");
}
writeFileSync(join(genRoot, "prisma", "schema.prisma"), schema);

sh(
  "pnpm",
  [
    "--filter",
    "@nusantara/db",
    "exec",
    "prisma",
    "generate",
    "--schema",
    join(genRoot, "prisma", "schema.prisma"),
  ],
  {
    env: {
      ...process.env,
      CHECKPOINT_DISABLE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
  },
);

// ---------------------------------------------------------------------------
// 2. The server processes, one minified file each
// ---------------------------------------------------------------------------

const ENTRIES = {
  api: "apps/api/src/server.ts",
  worker: "apps/worker/src/main.ts",
  webhook: "apps/whatsapp-webhook/src/server.ts",
  staff: "apps/api/src/cli/upsert-staff.ts",
  accounts: "apps/api/src/cli/seed-accounts.ts",
  knowledge: "apps/api/src/cli/import-knowledge.ts",
  chatbot: "apps/api/src/cli/chatbot-doctor.ts",
  // WhatsApp as a linked device (2026-10-22, docs/whatsapp-baileys.md).
  "wa-gateway": "apps/wa-gateway/src/main.ts",
};

/**
 * Baileys' optional image, audio and link-preview helpers. It imports each
 * with `import(…).catch()` and carries on without it — an image is sent with
 * no thumbnail, which is all sharp/jimp would add — so they are left out
 * rather than bundled: sharp is native code for one CPU and would have to
 * ship as files the way argon2 does, for a thumbnail.
 */
const BAILEYS_OPTIONAL = ["sharp", "jimp", "link-preview-js", "audio-decode"];

/** The generated client stays a directory of files next to the bundles. */
const prismaClientExternal = {
  name: "prisma-client-external",
  setup(build) {
    build.onResolve({ filter: /\/generated\/client(\/index\.js)?$/ }, () => ({
      path: "./prisma/index.js",
      external: true,
    }));
    // Anything reaching past @nusantara/db would bundle a client nobody generated.
    build.onResolve({ filter: /^@prisma\/client/ }, (args) => ({
      errors: [
        {
          text: `${args.importer} imports @prisma/client directly; go through @nusantara/db`,
        },
      ],
    }));
  },
};

const result = await esbuild.build({
  entryPoints: Object.fromEntries(
    Object.entries(ENTRIES).map(([out, src]) => [out, join(ROOT, src)]),
  ),
  outdir: join(stage, "app"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // keepNames stays off: nothing in this codebase reads a function's or a
  // class's name (checked 2026-09-11). The cost is that an error's `type` in
  // the logs is a mangled name; its message and stack still say what happened.
  minify: true,
  legalComments: "none",
  sourcemap: "external",
  sourcesContent: true,
  charset: "utf8",
  metafile: true,
  logLevel: "warning",
  // A native addon cannot be inlined; it ships as files (step 3).
  external: ["@node-rs/argon2", ...BAILEYS_OPTIONAL],
  plugins: [prismaClientExternal],
  // The CommonJS dependencies (express, pino, …) call require() and read
  // __dirname, and neither exists inside an ES module.
  banner: {
    js: [
      'import{createRequire as __nusCreateRequire}from"node:module";',
      'import{fileURLToPath as __nusFileURLToPath}from"node:url";',
      'import{dirname as __nusDirname}from"node:path";',
      "const require=__nusCreateRequire(import.meta.url);",
      "const __filename=__nusFileURLToPath(import.meta.url);",
      "const __dirname=__nusDirname(__filename);",
    ].join(""),
  },
});

// The maps stay on this machine.
const mapsDir = join(OUT, "maps", version);
mkdirSync(mapsDir, { recursive: true });
for (const f of readdirSync(join(stage, "app"))) {
  if (f.endsWith(".map")) renameSync(join(stage, "app", f), join(mapsDir, f));
}
writeFileSync(join(mapsDir, "metafile.json"), JSON.stringify(result.metafile));

// ---------------------------------------------------------------------------
// 3. The generated client and the native addons, as files
// ---------------------------------------------------------------------------

const genClient = join(genRoot, "client");
const prismaOut = join(stage, "app", "prisma");
mkdirSync(join(prismaOut, "runtime"), { recursive: true });
for (const f of ["package.json", "schema.prisma"]) {
  cpSync(join(genClient, f), join(prismaOut, f));
}
// The client records where it was generated: this machine's home directory.
// The runtime only ever asks `typeof` of those strings, so a neutral one does
// the same job without naming the laptop it was built on.
writeFileSync(
  join(prismaOut, "index.js"),
  readFileSync(join(genClient, "index.js"), "utf8").replaceAll(
    genRoot,
    "/release",
  ),
);
// Prisma's runtime ends by naming a source map of its own that is not shipped;
// drop the dangling reference rather than exempt anything from the audit.
writeFileSync(
  join(prismaOut, "runtime", "library.js"),
  readFileSync(join(genClient, "runtime", "library.js"), "utf8").replace(
    /^\/\/# sourceMappingURL=.*$/gm,
    "",
  ),
);
const engines = readdirSync(genClient).filter((f) =>
  /^libquery_engine-.*\.node$/.test(f),
);
if (engines.length !== 1) {
  throw new Error(
    `expected exactly one query engine, found: ${engines.join(", ") || "none"}`,
  );
}
cpSync(join(genClient, engines[0]), join(prismaOut, engines[0]));

const apiRequire = createRequire(join(ROOT, "apps", "api", "package.json"));
const argon = packageRoot(apiRequire, "@node-rs/argon2");
const argonNative = `@node-rs/argon2-${process.platform}-${process.arch}`;
const argonNativeRoot = packageRoot(
  createRequire(join(argon, "package.json")),
  argonNative,
);
cpSync(argon, join(stage, "node_modules", "@node-rs", "argon2"), {
  recursive: true,
  dereference: true,
});
cpSync(argonNativeRoot, join(stage, "node_modules", argonNative), {
  recursive: true,
  dereference: true,
});

// ---------------------------------------------------------------------------
// 4. The SPA
// ---------------------------------------------------------------------------

sh("pnpm", ["--filter", "@nusantara/web", "build"]);
cpSync(join(ROOT, "apps", "web", "dist"), join(stage, "web"), {
  recursive: true,
});

// ---------------------------------------------------------------------------
// 5. Ops scripts, and what this release is
// ---------------------------------------------------------------------------

cpSync(join(HERE, "ops"), join(stage, "ops"), { recursive: true });
// nusantara-deploy and setup-deploy-access ride along so an admin at the Mac
// mini can reinstall them from the live release; neither runs from here.
for (const f of [
  "run",
  "backup",
  "nusantara-deploy",
  "setup-deploy-access",
  "setup-staging",
  "reset-transactions",
  "fix-skus",
  "void-sale",
  "release-unit",
  "check-consistency",
]) {
  chmodSync(join(stage, "ops", f), 0o755);
}
writeFileSync(
  join(stage, "RELEASE"),
  [
    `version=${version}`,
    `commit=${sha}${dirty ? " (plus uncommitted changes)" : ""}`,
    `built=${builtAt.toISOString()}`,
    `arch=${arch}`,
    `node=${process.version}`,
    "",
  ].join("\n"),
);

// ---------------------------------------------------------------------------
// 6. Prove it: nothing that is source goes in the box
// ---------------------------------------------------------------------------

const home = homedir();
const offenders = [];
walk(stage, (file) => {
  const rel = relative(stage, file);
  // Third-party packages are public npm code, shipped as npm publishes them.
  if (rel.startsWith(`node_modules${sep}`) || rel.endsWith(".node")) return;
  if (/\.(ts|tsx|mts|cts|map)$/.test(rel)) {
    offenders.push(`${rel} is source or a source map`);
  }
  const text = readFileSync(file, "utf8");
  if (text.includes("sourceMappingURL")) {
    offenders.push(`${rel} points at a source map`);
  }
  if (text.includes(home)) {
    offenders.push(`${rel} names this machine's home directory`);
  }
});
if (offenders.length > 0) {
  console.error(
    `\n✗ refusing to pack — this would leave the machine:\n  ${offenders.join("\n  ")}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 7. Pack
// ---------------------------------------------------------------------------

const tarball = join(OUT, `${name}.tar.gz`);
// COPYFILE_DISABLE stops macOS tar adding ._ AppleDouble files for xattrs.
sh("tar", ["-czf", tarball, "-C", stageRoot, name], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log("\n✓ no .ts, no source maps, no build paths in the release");
for (const f of readdirSync(join(stage, "app")).filter((f) =>
  f.endsWith(".mjs"),
)) {
  console.log(
    `  app/${f.padEnd(12)} ${mb(statSync(join(stage, "app", f)).size)}`,
  );
}
console.log(`\n  ${relative(ROOT, tarball)}  ${mb(statSync(tarball).size)}`);
console.log(`  source maps (keep, never ship): ${relative(ROOT, mapsDir)}\n`);

// ---------------------------------------------------------------------------

/** Remove `//` comments (including `///` doc comments) outside string literals. */
function stripSchemaComments(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    let inString = false;
    let cut = line.length;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"' && line[i - 1] !== "\\") inString = !inString;
      else if (!inString && c === "/" && line[i + 1] === "/") {
        cut = i;
        break;
      }
    }
    const kept = line.slice(0, cut).trimEnd();
    if (kept !== "" || (lines.length > 0 && lines[lines.length - 1] !== "")) {
      lines.push(kept);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

/** The directory holding `name`'s package.json, found from its entry point. */
function packageRoot(requireFn, name) {
  let dir = dirname(requireFn.resolve(name));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, "utf8")).name === name
    ) {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`cannot find the package root of ${name}`);
    dir = up;
  }
}

function walk(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, fn);
    else fn(p);
  }
}
