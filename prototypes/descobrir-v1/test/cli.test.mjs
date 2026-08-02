/**
 * Seam under test (pre-agreed): the CLI command wrapper `main(options)` exported
 * from prototypes/descobrir-v1/cli.mjs. It parses argv, resolves+reads the
 * config, calls loadConfig, then runDescobrir, and emits a sanitized summary.
 * All IO (argv, cwd, prototypeRoot, stdout/stderr, readFile, pipeline, now) is
 * injectable; defaults bind real Node IO + the real pipeline.
 *
 * Direct entry (subprocess) is covered by spawning `node cli.mjs` directly —
 * but only for the failure path, never a successful run that writes real
 * prototype output.
 *
 * Module does not implement `main` yet — this import MUST fail first (RED),
 * then pass.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(here, "..", "cli.mjs");
const REV = "633d3a5d16c165073ede2b2248bae708483f2efe";

function makeStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
    },
    text() {
      return chunks.join("");
    },
  };
}

function validConfigText(resolverPath, overrides = {}) {
  return JSON.stringify({
    namespace: "nori-cloud",
    logical_repo: "nori-cloud",
    display_repo: "nori/cloud",
    source_revision: REV,
    resolver: { "nori-cloud": resolverPath },
    engine: { name: "explorer", profile: "nori-cloud-api", root: ".claude/explorer" },
    output: "./output",
    threshold: {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: true,
      require_repeatability_pass: true,
      require_mutation_equivalent: true,
      require_producer_reconciliation_pass: true,
    },
    ...overrides,
  });
}

function fakeResult({ passed = true } = {}) {
  return {
    records: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
    relations: [{ id: "x1" }],
    graphIndex: { canonical_graph_hash: "abc123def456" },
    coverageReport: {
      passed,
      provenance: {
        artifact_reference_percentage: 75,
        repository_verified_percentage: 50,
      },
    },
  };
}

describe("cli main — argument validation rejects before any IO", () => {
  for (const [label, argv] of [
    ["missing", []],
    ["unknown flag", ["--foo", "x"]],
    ["extra", ["--config", "x", "y"]],
    ["config without value", ["--config"]],
  ]) {
    test(`${label} args → exit 1, no read/run, typed stderr`, () => {
      let readCalls = 0;
      let runCalls = 0;
      const stdout = makeStream();
      const stderr = makeStream();
      const exitCode = main({
        argv,
        cwd: "/tmp/cli-args",
        prototypeRoot: "/tmp/cli-args/p",
        stdout,
        stderr,
        readFile: () => {
          readCalls += 1;
          return "{}";
        },
        run: () => {
          runCalls += 1;
          return fakeResult();
        },
        now: () => new Date("2026-08-02T12:00:00.000Z"),
      });

      assert.strictEqual(exitCode, 1);
      assert.strictEqual(readCalls, 0, "readFile must not be called on arg error");
      assert.strictEqual(runCalls, 0, "pipeline must not run on arg error");
      assert.strictEqual(stdout.text(), "", "no stdout on arg error");
      const errText = stderr.text();
      assert.ok(errText.length > 0, "stderr must describe the blocker");
      assert.match(errText, /CliError/, "stderr must include typed error name");
    });
  }
});

describe("cli main — happy path", () => {
  test("normalized config reaches pipeline, ISO observedAt, summary shape, exit 0", (context) => {
    const cwd = mkdtempSync(join(tmpdir(), "cli-happy-"));
    context.after(() => rmSync(cwd, { recursive: true, force: true }));
    const configPath = join(cwd, "descobrir.config.json");
    const resolverAbs = join(cwd, "target-repo");
    const prototypeRoot = join(cwd, "prototype");
    const stdout = makeStream();
    const stderr = makeStream();
    const fixed = new Date("2026-08-02T12:00:00.000Z");
    let readCalledWith = null;
    let runArg = null;

    const exitCode = main({
      argv: ["--config", "descobrir.config.json"],
      cwd,
      prototypeRoot,
      stdout,
      stderr,
      readFile: (p) => {
        readCalledWith = p;
        return validConfigText(resolverAbs);
      },
      run: (arg) => {
        runArg = arg;
        return fakeResult({ passed: true });
      },
      now: () => fixed,
    });

    assert.strictEqual(exitCode, 0, "happy path returns exit 0");
    assert.strictEqual(readCalledWith, configPath, "config path resolved against cwd");
    assert.ok(runArg, "injected pipeline must be invoked");

    // Normalized config reaches the pipeline (proves loadConfig ran).
    assert.strictEqual(runArg.config.namespace, "nori-cloud");
    assert.strictEqual(runArg.config.engine.profile, "nori-cloud-api");
    assert.strictEqual(
      runArg.config.threshold.minimum_repository_verified_percentage,
      0,
    );
    assert.strictEqual(runArg.config.output, join(cwd, "output"));
    assert.strictEqual(runArg.prototypeRoot, prototypeRoot);

    // observedAt is ISO 8601 UTC.
    assert.match(
      runArg.observedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
      "observedAt must be ISO",
    );
    assert.strictEqual(runArg.observedAt, fixed.toISOString());

    // stdout summary: exactly the allowed fields, nothing leaked.
    const summary = JSON.parse(stdout.text());
    assert.deepStrictEqual(summary, {
      status: "passed",
      canonical_graph_hash: "abc123def456",
      records: 3,
      relations: 1,
      artifact_reference_percentage: 75,
      repository_verified_percentage: 50,
    });
    assert.strictEqual(stderr.text(), "", "no stderr on success");
  });
});

describe("cli main — gate false", () => {
  test("pipeline completes but coverage gate false → exit 2, status failed", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    const exitCode = main({
      argv: ["--config", "c.json"],
      cwd: "/tmp/cli-gate",
      prototypeRoot: "/tmp/cli-gate/prototype",
      stdout,
      stderr,
      readFile: () => validConfigText("/tmp/cli-gate/target"),
      run: () => fakeResult({ passed: false }),
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    assert.strictEqual(exitCode, 2);
    const summary = JSON.parse(stdout.text());
    assert.strictEqual(summary.status, "failed");
    assert.strictEqual(summary.canonical_graph_hash, "abc123def456");
    assert.strictEqual(summary.records, 3);
  });
});

describe("cli main — config blocker", () => {
  test("malformed config → exit 1, ConfigError name, no config text leaked", (context) => {
    const cwd = mkdtempSync(join(tmpdir(), "cli-malformed-"));
    context.after(() => rmSync(cwd, { recursive: true, force: true }));
    const secret = "SECRET_LEAK_SENTINEL_xyz_never_in_stderr";
    // Missing required fields + a trailing sentinel that must never surface.
    const badText = JSON.stringify({ namespace: "nori-cloud", source_revision: "bad" }) + secret;
    const stdout = makeStream();
    const stderr = makeStream();
    let runCalls = 0;

    const exitCode = main({
      argv: ["--config", "c.json"],
      cwd,
      prototypeRoot: join(cwd, "p"),
      stdout,
      stderr,
      readFile: () => badText,
      run: () => {
        runCalls += 1;
        return fakeResult();
      },
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    assert.strictEqual(exitCode, 1);
    assert.strictEqual(runCalls, 0, "pipeline must not run on config error");
    assert.strictEqual(stdout.text(), "", "no stdout on config error");
    const errText = stderr.text();
    assert.match(errText, /ConfigError/, "stderr must include ConfigError name");
    assert.ok(!errText.includes(secret), "config text must not leak to stderr");
    assert.ok(!errText.includes(badText), "raw config text must not leak to stderr");
  });
});

describe("cli main — runtime blocker redaction", () => {
  test("pipeline error redacts resolver/prototype/config-dir absolute paths", (context) => {
    const cwd = mkdtempSync(join(tmpdir(), "cli-redact-"));
    context.after(() => rmSync(cwd, { recursive: true, force: true }));
    const prototypeRoot = join(cwd, "prototype");
    const resolverAbs = join(cwd, "target-repo");
    const stdout = makeStream();
    const stderr = makeStream();

    const exitCode = main({
      argv: ["--config", "c.json"],
      cwd,
      prototypeRoot,
      stdout,
      stderr,
      readFile: () => validConfigText(resolverAbs),
      run: () => {
        const err = new Error(
          `boom at ${resolverAbs} then ${prototypeRoot} then ${cwd}/more`,
        );
        err.name = "PipelineError";
        throw err;
      },
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    assert.strictEqual(exitCode, 1);
    assert.strictEqual(stdout.text(), "", "no stdout on runtime blocker");
    const errText = stderr.text();
    assert.match(errText, /PipelineError/, "stderr must include typed error name");
    assert.ok(!errText.includes(resolverAbs), "resolver path must be redacted");
    assert.ok(!errText.includes(prototypeRoot), "prototype path must be redacted");
    assert.ok(!errText.includes(cwd), "config-dir path must be redacted");
    assert.ok(
      errText.includes("<resolver>") ||
        errText.includes("<prototype>") ||
        errText.includes("<config-dir>"),
      "stderr must show at least one path placeholder",
    );
  });

  test("read failure → exit 1, typed name, sanitized", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let runCalls = 0;
    const exitCode = main({
      argv: ["--config", "missing.json"],
      cwd: "/tmp/cli-readfail",
      prototypeRoot: "/tmp/cli-readfail/p",
      stdout,
      stderr,
      readFile: () => {
        const err = new Error("ENOENT: no such file /tmp/cli-readfail/missing.json");
        err.name = "ReadError";
        throw err;
      },
      run: () => {
        runCalls += 1;
        return fakeResult();
      },
      now: () => new Date("2026-08-02T12:00:00.000Z"),
    });

    assert.strictEqual(exitCode, 1);
    assert.strictEqual(runCalls, 0);
    assert.strictEqual(stdout.text(), "");
    assert.match(stderr.text(), /ReadError/);
  });
});

describe("cli direct entry (subprocess)", () => {
  test("no args → exit 1 and does not emit old 'not implemented' stub", () => {
    // Failure path only — never spawn a successful run that writes real output.
    const result = spawnSync(process.execPath, [CLI_PATH], {
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 1, "direct entry with no args exits 1");
    assert.strictEqual(result.stdout, "", "no stdout on arg error");
    const errText = result.stderr || "";
    assert.ok(
      !errText.includes("not implemented"),
      "must not emit old stub message",
    );
    assert.ok(errText.trim().length > 0, "must emit a typed blocker message");
    assert.match(errText, /CliError/);
  });
});
