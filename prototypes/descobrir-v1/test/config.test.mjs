import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

// Seam under test (pre-agreed, ADR 0003 + descobrir.config.example.json):
// pure parsing + validation of the ephemeral config text into a normalized
// config object. Machine paths live ONLY inside the resolver map and the
// cwd-resolved output path — both fields of the returned ephemeral config.
// Module does not exist yet — this import MUST fail first (RED), then pass.
import { loadConfig, ConfigError } from "../src/config.mjs";

const CWD = "/tmp/descobrir-v1";

const VALID_CONFIG = {
  namespace: "nori-cloud",
  logical_repo: "nori-cloud",
  display_repo: "nori/cloud",
  source_revision: "633d3a5d16c165073ede2b2248bae708483f2efe",
  resolver: {
    "nori-cloud": "/Users/pilot/repos/nori-cloud",
  },
  engine: { name: "explorer", profile: "nori-cloud-api", root: ".claude/explorer" },
  output: "./output",
  threshold: {
    minimum_repository_verified_percentage: 0,
    require_schema_valid: true,
    require_repeatability_pass: true,
    require_mutation_equivalent: true,
    require_producer_reconciliation_pass: true,
  },
};

function configText(overrides = {}) {
  return JSON.stringify({ ...VALID_CONFIG, ...overrides });
}

describe("loadConfig — happy path", () => {
  test("returns normalized config with all expected fields", () => {
    // Given a valid config text matching descobrir.config.example.json
    // When loaded with a cwd
    // Then every normalized field is present and correctly typed
    const cfg = loadConfig({ configText: configText(), cwd: CWD });
    assert.strictEqual(cfg.namespace, "nori-cloud");
    assert.strictEqual(cfg.logical_repo, "nori-cloud");
    assert.strictEqual(cfg.display_repo, "nori/cloud");
    assert.strictEqual(cfg.source_revision, "633d3a5d16c165073ede2b2248bae708483f2efe");
    assert.deepStrictEqual(cfg.resolver, { "nori-cloud": "/Users/pilot/repos/nori-cloud" });
    assert.deepStrictEqual(cfg.engine, {
      name: "explorer",
      profile: "nori-cloud-api",
      root: ".claude/explorer",
    });
    assert.strictEqual(cfg.output, resolve(CWD, "output"));
    assert.deepStrictEqual(cfg.threshold, {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: true,
      require_repeatability_pass: true,
      require_mutation_equivalent: true,
      require_producer_reconciliation_pass: true,
    });
  });

  test("resolves output against cwd (machine path lives only in returned config)", () => {
    // Given output as a relative path
    // When loaded with cwd
    // Then the returned output is the absolute path resolved against cwd
    const cfg = loadConfig({ configText: configText({ output: "runs/abc" }), cwd: CWD });
    assert.strictEqual(cfg.output, resolve(CWD, "runs/abc"));
  });

  test("keeps engine.root relative (repo-internal path, NOT a machine path)", () => {
    // Given engine.root as a repo-relative path
    // When loaded
    // Then engine.root stays relative — it is resolved against the resolver root later, not cwd
    const cfg = loadConfig({ configText: configText(), cwd: CWD });
    assert.strictEqual(cfg.engine.root, ".claude/explorer");
    assert.ok(!cfg.engine.root.startsWith("/"));
  });

  test("accepts abbreviated 7-char hex revision", () => {
    // Given a 7-char hex revision (git short SHA minimum)
    // When loaded
    // Then it is accepted (rule: 7-64 lowercase hex)
    const cfg = loadConfig({
      configText: configText({ source_revision: "633d3a5" }),
      cwd: CWD,
    });
    assert.strictEqual(cfg.source_revision, "633d3a5");
  });

  test("accepts 64-char hex revision (SHA-256)", () => {
    // Given a 64-char hex revision
    // When loaded
    // Then it is accepted
    const rev = "a".repeat(64);
    const cfg = loadConfig({ configText: configText({ source_revision: rev }), cwd: CWD });
    assert.strictEqual(cfg.source_revision, rev);
  });

  test("omits display_repo from the returned config when absent (optional field)", () => {
    // Given a config without the optional display_repo
    // When loaded
    // Then display_repo is not present in the returned config
    const raw = { ...VALID_CONFIG };
    delete raw.display_repo;
    const cfg = loadConfig({ configText: JSON.stringify(raw), cwd: CWD });
    assert.ok(!("display_repo" in cfg));
  });
});

describe("loadConfig — malformed JSON", () => {
  test("rejects empty text", () => {
    assert.throws(() => loadConfig({ configText: "", cwd: CWD }), ConfigError);
  });

  test("rejects whitespace-only text", () => {
    assert.throws(() => loadConfig({ configText: "   \n  ", cwd: CWD }), ConfigError);
  });

  test("rejects truncated JSON", () => {
    assert.throws(() => loadConfig({ configText: "{", cwd: CWD }), ConfigError);
  });

  test("rejects non-JSON text", () => {
    assert.throws(() => loadConfig({ configText: "hello", cwd: CWD }), ConfigError);
  });

  test("rejects JSON root that is not an object", () => {
    assert.throws(
      () => loadConfig({ configText: '["not", "an", "object"]', cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — missing required fields", () => {
  for (const field of [
    "namespace",
    "logical_repo",
    "source_revision",
    "resolver",
    "engine",
    "output",
  ]) {
    test(`rejects missing '${field}'`, () => {
      const raw = { ...VALID_CONFIG };
      delete raw[field];
      assert.throws(
        () => loadConfig({ configText: JSON.stringify(raw), cwd: CWD }),
        ConfigError,
      );
    });
  }

  test("rejects missing engine.name", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { root: ".claude/explorer" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects missing engine.root", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects missing engine.profile", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: ".claude/explorer" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects empty engine.profile", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({
            engine: { name: "explorer", profile: "", root: ".claude/explorer" },
          }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects whitespace engine.profile", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({
            engine: { name: "explorer", profile: "api profile", root: ".claude/explorer" },
          }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid namespace", () => {
  test("rejects namespace with whitespace", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ namespace: "nori cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects namespace with '/' (display form, not single token)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ namespace: "nori/cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects namespace with '@'", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ namespace: "nori@cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects empty namespace", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ namespace: "" }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid logical_repo (single-token rule)", () => {
  test("rejects '/' (display form, not single token)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ logical_repo: "nori/cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects whitespace", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ logical_repo: "nori cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects '@'", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ logical_repo: "nori@cloud" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects empty", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ logical_repo: "" }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid source_revision (hex 7-64)", () => {
  test("rejects non-hex characters", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ source_revision: "ghijklmnop" }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects fewer than 7 hex chars", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ source_revision: "abc123" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects more than 64 hex chars", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ source_revision: "a".repeat(65) }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects uppercase hex (lowercase only)", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ source_revision: "A".repeat(40) }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects empty", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ source_revision: "" }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid resolver", () => {
  test("rejects resolver missing the logical_repo key", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ resolver: { "other-repo": "/x/y" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects unresolved placeholder path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({
            resolver: { "nori-cloud": "<ABSOLUTE_PATH_TO_NORI_CLOUD>" },
          }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects placeholder pattern with surrounding angle brackets", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({
            resolver: { "nori-cloud": "</some/path>" },
          }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects relative resolver path (machine path must be absolute)", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ resolver: { "nori-cloud": "relative/path" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects empty resolver path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ resolver: { "nori-cloud": "" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects NUL byte in resolver path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({
            resolver: { "nori-cloud": "/x/\x00y" },
          }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects non-object resolver (array)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ resolver: [] }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects non-object resolver (null)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ resolver: null }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid engine artifact root", () => {
  test("rejects absolute engine.root (machine path forbidden here)", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: "/etc/explorer" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects '..' segment (escape attempt)", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: ".." } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects '..' mid-path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: "a/../b" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects backslash in path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: "explorer\\sub" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects whitespace in path", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "explorer", root: "a b/c" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects empty engine.name", () => {
    assert.throws(
      () =>
        loadConfig({
          configText: configText({ engine: { name: "", root: ".claude/explorer" } }),
          cwd: CWD,
        }),
      ConfigError,
    );
  });

  test("rejects non-object engine", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ engine: "explorer" }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid output", () => {
  test("rejects absolute output (must be cwd-relative)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ output: "/absolute/output" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects '..' segment (escape from cwd)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ output: "../escape" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects empty output", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ output: "" }), cwd: CWD }),
      ConfigError,
    );
  });
});

describe("loadConfig — invalid cwd", () => {
  test("rejects missing cwd", () => {
    assert.throws(() => loadConfig({ configText: configText() }), ConfigError);
  });

  test("rejects empty cwd", () => {
    assert.throws(() => loadConfig({ configText: configText(), cwd: "" }), ConfigError);
  });

  test("rejects non-string cwd", () => {
    assert.throws(
      () => loadConfig({ configText: configText(), cwd: 123 }),
      ConfigError,
    );
  });
});

describe("loadConfig — error type", () => {
  test("all rejections throw ConfigError, not plain Error", () => {
    // Given any malformed input
    // When loadConfig is called
    // Then the thrown error is an instance of ConfigError (typed error contract)
    assert.throws(
      () => loadConfig({ configText: "{", cwd: CWD }),
      (err) => err instanceof ConfigError && err.name === "ConfigError",
    );
  });
});

describe("loadConfig — threshold block (CoverageReport gate)", () => {
  // Seam: the threshold block mirrors the CoverageReport schema threshold
  // (workflows/descobrir/contracts/coverage-report.schema.json). All five
  // fields are required; no defaults, no unknown properties, no hidden policy.

  const VALID_THRESHOLD = {
    minimum_repository_verified_percentage: 0,
    require_schema_valid: true,
    require_repeatability_pass: true,
    require_mutation_equivalent: true,
    require_producer_reconciliation_pass: true,
  };

  function thresholdConfig(thresholdOverrides) {
    return configText({
      threshold: { ...VALID_THRESHOLD, ...thresholdOverrides },
    });
  }

  test("normalizes threshold with all five fields in canonical order", () => {
    // Given a valid threshold block
    // When loaded
    // Then the returned threshold has exactly the five schema fields, normalized
    const cfg = loadConfig({ configText: configText(), cwd: CWD });
    assert.deepStrictEqual(cfg.threshold, {
      minimum_repository_verified_percentage: 0,
      require_schema_valid: true,
      require_repeatability_pass: true,
      require_mutation_equivalent: true,
      require_producer_reconciliation_pass: true,
    });
    // Exactly five keys — no leaked extra properties, no defaults invented.
    assert.deepStrictEqual(
      Object.keys(cfg.threshold).sort(),
      [
        "minimum_repository_verified_percentage",
        "require_mutation_equivalent",
        "require_producer_reconciliation_pass",
        "require_repeatability_pass",
        "require_schema_valid",
      ],
    );
  });

  test("accepts boundary minimum_repository_verified_percentage = 0", () => {
    const cfg = loadConfig({
      configText: thresholdConfig({ minimum_repository_verified_percentage: 0 }),
      cwd: CWD,
    });
    assert.strictEqual(cfg.threshold.minimum_repository_verified_percentage, 0);
  });

  test("accepts boundary minimum_repository_verified_percentage = 100", () => {
    const cfg = loadConfig({
      configText: thresholdConfig({ minimum_repository_verified_percentage: 100 }),
      cwd: CWD,
    });
    assert.strictEqual(cfg.threshold.minimum_repository_verified_percentage, 100);
  });

  test("accepts fractional minimum within range (e.g. 42.5)", () => {
    const cfg = loadConfig({
      configText: thresholdConfig({ minimum_repository_verified_percentage: 42.5 }),
      cwd: CWD,
    });
    assert.strictEqual(cfg.threshold.minimum_repository_verified_percentage, 42.5);
  });

  test("preserves require flag values verbatim (false is a real policy choice)", () => {
    const cfg = loadConfig({
      configText: thresholdConfig({
        require_schema_valid: false,
        require_repeatability_pass: false,
        require_mutation_equivalent: false,
        require_producer_reconciliation_pass: false,
      }),
      cwd: CWD,
    });
    assert.strictEqual(cfg.threshold.require_schema_valid, false);
    assert.strictEqual(cfg.threshold.require_repeatability_pass, false);
    assert.strictEqual(cfg.threshold.require_mutation_equivalent, false);
    assert.strictEqual(cfg.threshold.require_producer_reconciliation_pass, false);
  });

  test("rejects missing threshold block", () => {
    const raw = { ...VALID_CONFIG };
    delete raw.threshold;
    assert.throws(
      () => loadConfig({ configText: JSON.stringify(raw), cwd: CWD }),
      ConfigError,
    );
  });

  for (const field of [
    "minimum_repository_verified_percentage",
    "require_schema_valid",
    "require_repeatability_pass",
    "require_mutation_equivalent",
    "require_producer_reconciliation_pass",
  ]) {
    test(`rejects threshold missing '${field}'`, () => {
      const threshold = { ...VALID_THRESHOLD };
      delete threshold[field];
      assert.throws(
        () => loadConfig({ configText: configText({ threshold }), cwd: CWD }),
        ConfigError,
      );
    });
  }

  test("rejects non-object threshold (null)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ threshold: null }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects non-object threshold (array)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ threshold: [] }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects non-object threshold (string)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ threshold: "strict" }), cwd: CWD }),
      ConfigError,
    );
  });

  test("rejects non-object threshold (number)", () => {
    assert.throws(
      () => loadConfig({ configText: configText({ threshold: 100 }), cwd: CWD }),
      ConfigError,
    );
  });

  describe("minimum_repository_verified_percentage — type and range", () => {
    for (const [label, value] of [
      ["string", "50"],
      ["boolean true", true],
      ["boolean false", false],
      ["null", null],
      ["array", [50]],
      ["object", { x: 50 }],
    ]) {
      test(`rejects ${label}`, () => {
        assert.throws(
          () =>
            loadConfig({
              configText: thresholdConfig({ minimum_repository_verified_percentage: value }),
              cwd: CWD,
            }),
          ConfigError,
        );
      });
    }

    test("rejects NaN", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: NaN }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });

    test("rejects Infinity", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: Infinity }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });

    test("rejects -1 (below 0)", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: -1 }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });

    test("rejects -0.5 (below 0)", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: -0.5 }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });

    test("rejects 100.0001 (above 100)", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: 100.0001 }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });

    test("rejects 101 (above 100)", () => {
      assert.throws(
        () =>
          loadConfig({
            configText: thresholdConfig({ minimum_repository_verified_percentage: 101 }),
            cwd: CWD,
          }),
        ConfigError,
      );
    });
  });

  describe("require_* flags — must be booleans", () => {
    const flags = [
      "require_schema_valid",
      "require_repeatability_pass",
      "require_mutation_equivalent",
      "require_producer_reconciliation_pass",
    ];
    for (const flag of flags) {
      for (const [label, value] of [
        ["string", "true"],
        ["number 1", 1],
        ["number 0", 0],
        ["null", null],
        ["array", [true]],
        ["object", { ok: true }],
      ]) {
        test(`rejects ${flag} = ${label}`, () => {
          assert.throws(
            () =>
              loadConfig({
                configText: thresholdConfig({ [flag]: value }),
                cwd: CWD,
              }),
            ConfigError,
          );
        });
      }
    }
  });

  describe("threshold — additionalProperties: false (no ignored policy)", () => {
    test("rejects unknown property alongside valid fields", () => {
      const threshold = {
        ...VALID_THRESHOLD,
        require_repository_verified: true,
      };
      assert.throws(
        () => loadConfig({ configText: configText({ threshold }), cwd: CWD }),
        ConfigError,
      );
    });

    test("rejects misspelled field (typo would silently relax the gate)", () => {
      const threshold = {
        ...VALID_THRESHOLD,
        minimum_repository_verified_percent: 50,
      };
      assert.throws(
        () => loadConfig({ configText: configText({ threshold }), cwd: CWD }),
        ConfigError,
      );
    });

    test("rejects extra field that looks like a future flag", () => {
      const threshold = {
        ...VALID_THRESHOLD,
        require_freshness_pass: true,
      };
      assert.throws(
        () => loadConfig({ configText: configText({ threshold }), cwd: CWD }),
        ConfigError,
      );
    });
  });
});
