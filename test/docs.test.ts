import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function docs(): ReadonlyArray<readonly [string, string]> {
  return [
    ["AGENTS.md", readFileSync("AGENTS.md", "utf8")],
    ["README.md", readFileSync("README.md", "utf8")],
    ["DECISIONS.md", readFileSync("DECISIONS.md", "utf8")],
    ["MEMORY.md", readFileSync("MEMORY.md", "utf8")],
  ];
}

test("agent docs keep the starter contract and this repo's deltas", () => {
  const [agentsRaw, readmeRaw, decisionsRaw, memoryRaw] = docs().map(([, text]) => text);
  const agents = flat(agentsRaw ?? "");
  const readme = flat(readmeRaw ?? "");
  const decisions = flat(decisionsRaw ?? "");
  const memory = flat(memoryRaw ?? "");

  for (const phrase of [
    "v1_*",
    "never Ash",
    "GET /health",
    "GET /",
    "GET /v1/years",
    "GET /v1/speakers",
    "GET /v1/speakers/{slug}",
    "GET /v1/speakers/{year}/{slug}",
    "GET /v1/sponsors",
    "GET /v1/sponsors/{slug}",
    "GET /v1/sponsors/{year}/{slug}",
    "year-scoped",
    "Register once on boot",
    "if `CAROLINA_URL` is unset or the POST fails, log and keep serving",
    "does not touch the database",
    "Node 25",
    "TypeScript ESM",
    "node:http",
    "pg",
    "setQueryFn",
    "npm test",
    "npm run sast",
    "npm run audit",
    "gitleaks detect",
    "npm run style",
    "npm run hooks",
    "no `openapi.yaml`",
    "db/",
    "images/",
    "Compose catalog",
    "dual-stack on IPv6",
    "Postgres 16",
    "DECISIONS.md",
    "MEMORY.md",
  ]) {
    assert.ok(agents.includes(phrase), `AGENTS.md missing ${phrase}`);
  }

  assert.match(agents, /Before an architectural edit, read `DECISIONS\.md` and `MEMORY\.md`/);
  assert.match(agents, /new durable decision.*appended to `DECISIONS\.md`/);
  assert.match(agents, /new command, version pin, or gotcha goes in `MEMORY\.md`/);

  for (const phrase of [
    "Node 25",
    "TypeScript: 5.9",
    "node:http",
    "pg",
    "tsx",
    "eslint-plugin-security",
    "Prettier",
    "gitleaks 8.30.1",
    "CRaC does not apply to this Node service",
  ]) {
    assert.ok(readme.includes(phrase), `README.md missing ${phrase}`);
  }

  for (const label of ["Status:", "### Context", "### Decision", "### Consequences"]) {
    assert.ok(decisions.includes(label), `DECISIONS.md missing ${label}`);
  }
  for (const topic of [
    "node:http",
    "third-party HTTP framework",
    "v1_*",
    "Ash",
    "setQueryFn",
    "fake catalog",
    "suspend",
    "CRaC does not apply",
    "npm test",
    "npm run sast",
    "npm run audit",
    "gitleaks detect",
    "npm run style",
  ]) {
    assert.ok(decisions.includes(topic), `DECISIONS.md missing ${topic}`);
  }

  assert.match(memory, /Do not restate an ADR/);
  assert.ok(memory.includes("npm test"), "MEMORY.md missing npm test");
  assert.ok(memory.includes("gitleaks 8.30.1"), "MEMORY.md missing gitleaks pin");
  assert.ok(memory.includes("node:http"), "MEMORY.md missing node:http");
  assert.equal(
    decisions.includes("npm install"),
    false,
    "DECISIONS.md must not become a second command list",
  );
});

test("agent docs do not contain private data", () => {
  const needles = ["AK" + "IA", "gh" + "p_", "fly" + "_", "zebra-" + "hydra", "." + "internal"];
  const privateKey = new RegExp("BEGIN [A-Z ]*" + "PRIVATE KEY");
  const bearer = /bearer\s+([^\s`"']+)/gi;

  for (const [path, text] of docs()) {
    assert.doesNotMatch(text, privateKey, `${path} has a private key block`);
    for (const needle of needles) {
      assert.equal(text.includes(needle), false, `${path} contains ${needle}`);
    }
    for (const match of text.matchAll(bearer)) {
      const value = match[1] ?? "";
      assert.equal(value, "dev", `${path} has a bearer value other than dev: ${value}`);
    }
  }
});
