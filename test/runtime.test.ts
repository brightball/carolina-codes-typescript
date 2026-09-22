import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function assignment(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function memoryMb(value: string): number {
  const match = /^(\d+)\s*(mb|gb)$/i.exec(value.trim());
  assert.ok(match, `unrecognized memory setting ${value}`);
  const amount = Number(match[1]);
  return match[2].toLowerCase() === "gb" ? amount * 1024 : amount;
}

test("fly.toml idle policy can suspend and still proxies /health", () => {
  const toml = readFileSync("fly.toml", "utf8");
  const stop = unquote(assignment(toml, /^\s*auto_stop_machines\s*=\s*(.+?)\s*$/m) ?? "");
  const min = Number(assignment(toml, /^\s*min_machines_running\s*=\s*(.+?)\s*$/m));
  assert.equal(Number.isFinite(min), true);
  assert.equal(stop === "stop" && min === 0, false);
  assert.equal(stop === "suspend" || min >= 1, true);
  const memory = unquote(assignment(toml, /^\s*memory\s*=\s*(.+?)\s*$/m) ?? "");
  assert.ok(memoryMb(memory) <= 2048);
  assert.equal(assignment(toml, /^\s*swap_size_mb\s*=\s*(.+?)\s*$/m), undefined);
  assert.equal(unquote(assignment(toml, /^\s*method\s*=\s*(.+?)\s*$/m) ?? ""), "GET");
  assert.match(toml, /path\s*=\s*"\/health"/);
});

test("runtime image stage is compiled JS with production dependencies only", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const stages = dockerfile.split(/^FROM\s+/m).slice(1);
  assert.ok(stages.length >= 2, "Dockerfile needs a build stage and a runtime stage");
  const build = stages[0] ?? "";
  const runtime = stages[stages.length - 1] ?? "";
  assert.match(build, /\bnpx tsc\b/);
  assert.match(runtime, /npm ci --omit=dev\b/);
  assert.doesNotMatch(runtime, /npm install/);
  assert.doesNotMatch(runtime, /--omit=dev=false/);
  assert.doesNotMatch(runtime, /\bnpx tsc\b/);
  assert.doesNotMatch(runtime, /\btypescript\b/);
  assert.doesNotMatch(runtime, /\beslint\b/);
  assert.doesNotMatch(runtime, /\btsx\b/);
  assert.match(runtime, /CMD \["node", "dist\/server\.js"\]/);

  const ignore = readFileSync(".dockerignore", "utf8");
  assert.match(ignore, /^node_modules$/m);
  assert.match(ignore, /^dist$/m);
});
