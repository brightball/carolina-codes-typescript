import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WORKFLOW_PATH = ".gitea/workflows/precommit.yml";
const CHECK_JOBS = ["test", "sast", "audit", "gitleaks", "style"] as const;
const GATES: Record<(typeof CHECK_JOBS)[number], string> = {
  test: "npm test",
  sast: "npm run sast",
  audit: "npm run audit",
  gitleaks: "gitleaks detect --source . --verbose",
  style: "npm run style",
};
const CLONE_CMD =
  'git clone --depth 1 --no-checkout "https://x-access-token:${token}@${host}/${GITHUB_REPOSITORY}" .';

function workflowJobs(yaml: string): Record<string, string> {
  const parts = yaml.split(/^jobs:\s*$/m);
  assert.equal(parts.length, 2, "workflow must have a jobs: block");
  const rest = parts[1] ?? "";
  const header = /^  ([A-Za-z0-9_-]+):\s*$/gm;
  const matches = [...rest.matchAll(header)];
  assert.ok(matches.length > 0, "workflow has no job ids");
  const out: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i]?.[1];
    assert.ok(name, "job header missing name");
    const full = matches[i]?.[0] ?? "";
    const start = (matches[i]?.index ?? 0) + full.length;
    const end = i + 1 < matches.length ? (matches[i + 1]?.index ?? rest.length) : rest.length;
    out[name] = rest.slice(start, end);
  }
  return out;
}

test("Gitea precommit prep job is shared by the five quality checks", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const jobs = workflowJobs(yaml);

  assert.ok(jobs.prep, "workflow must have a prep job");
  assert.deepEqual(
    Object.keys(jobs).sort(),
    ["audit", "gitleaks", "prep", "sast", "style", "test"],
    "workflow must be prep plus the five named quality jobs",
  );

  assert.equal(yaml.includes("uses: actions/checkout"), false, "must not use actions/checkout");
  assert.match(yaml, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.doesNotMatch(yaml, /^\s*git init\b/m);
  for (const [name, body] of Object.entries(jobs)) {
    assert.equal(
      body.includes("init.defaultBranch"),
      false,
      `${name} must not set init.defaultBranch`,
    );
    assert.doesNotMatch(body, /^\s*git init\b/m, `${name} must not git init`);
  }

  const prep = jobs.prep;
  assert.ok(prep.includes(CLONE_CMD), "prep must clone GITHUB_SHA with the job token");
  assert.ok(prep.includes('git fetch --depth 1 origin "${GITHUB_SHA}"'));
  assert.ok(prep.includes("npm ci"), "prep must install Node packages once");
  assert.ok(prep.includes("gitleaks_8.30.1_linux_x64.tar.gz"), "prep must stage gitleaks 8.30.1");
  assert.ok(prep.includes("tar -czf /tmp/prep-workspace.tar.gz"));
  assert.equal(
    prep.includes("--exclude"),
    false,
    "prep must keep .git so gitleaks detect can scan the cloned SHA",
  );
  assert.ok(prep.includes("actions/upload-artifact@v3"));
  assert.ok(prep.includes("name: prep-workspace"));
  assert.equal(prep.includes("needs: prep"), false);
  assert.equal(prep.includes("actions/upload-artifact@v4"), false);

  for (const name of CHECK_JOBS) {
    const body = jobs[name];
    assert.ok(body, `missing job ${name}`);
    assert.ok(body.includes("needs: prep"), `${name} must wait on prep`);
    assert.ok(
      body.includes("actions/download-artifact@v3"),
      `${name} must restore the prep artifact`,
    );
    assert.ok(body.includes("name: prep-workspace"), `${name} must download prep-workspace`);
    assert.ok(body.includes("prep-workspace.tar.gz"), `${name} must unpack the prep workspace`);
    assert.ok(body.includes(GATES[name]), `${name} must run ${GATES[name]}`);

    assert.equal(body.includes("git clone"), false, `${name} must not clone`);
    assert.equal(body.includes("npm ci"), false, `${name} must not npm ci`);
    assert.equal(body.includes("apt-get"), false, `${name} must not apt-get git`);
    assert.equal(body.includes("gitleaks/releases"), false, `${name} must not download gitleaks`);
    assert.equal(body.includes("gitleaks_8.30.1"), false, `${name} must not download gitleaks`);
    assert.doesNotMatch(body, /^\s+needs: (?!prep\s*$)/m, `${name} must not wait on other checks`);
  }

  const cloneJobs = Object.entries(jobs)
    .filter(([, body]) => body.includes("git clone"))
    .map(([name]) => name);
  assert.deepEqual(cloneJobs, ["prep"], "only prep clones GITHUB_SHA");

  const ciJobs = Object.entries(jobs)
    .filter(([, body]) => body.includes("npm ci"))
    .map(([name]) => name);
  assert.deepEqual(ciJobs, ["prep"], "only prep runs npm ci");
});
