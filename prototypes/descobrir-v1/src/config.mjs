/**
 * Config loader for Descobrir v1 (ADR 0003 + descobrir.config.example.json).
 *
 * Pure parsing + validation of the ephemeral config text into a normalized
 * config object. Machine paths live ONLY inside the resolver map (the
 * logical_repo → local clone mapping) and the cwd-resolved output path —
 * both fields of the returned ephemeral config. engine.root is repo-relative
 * and stays relative; it is anchored against the resolver root later, not cwd.
 *
 * Validation follows the contract in ADR 0003 and the example config:
 *   - namespace, logical_repo: non-empty single token (no '@', '/', whitespace)
 *   - engine.profile: non-empty single token metadata (no '@', '/', whitespace)
 *   - source_revision: 7-64 lowercase hex chars (git short SHA minimum through SHA-256)
 *   - resolver: object mapping logical_repo → absolute machine path; placeholder
 *     form (`<...>`) is rejected as an unresolved template value
 *   - engine.root, output: relative POSIX path (no '.', '..', leading '/',
 *     backslash, whitespace, NUL, reserved '%', '?', '#', '@')
 *   - threshold: CoverageReport gate block (workflows/descobrir/contracts/
 *     coverage-report.schema.json). Exactly five fields, no defaults, no
 *     unknown properties: minimum_repository_verified_percentage (finite
 *     number 0..100) and four require_* booleans. minimum 0 is the initial
 *     empirical pilot floor — Gate C may raise it explicitly.
 *
 * `output` is resolved against `cwd` to produce the only other machine path
 * in the returned config besides the resolver mapping. Node built-ins only.
 */

import { resolve } from "node:path";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

const FORBIDDEN_SEGMENT_CHARS = ["\\", "%", "?", "#", "@"];
const REVISION_RE = /^[a-f0-9]{7,64}$/;
const PLACEHOLDER_RE = /<[^\n>]*>/;
const REQUIRED_FIELDS = [
  "namespace",
  "logical_repo",
  "source_revision",
  "resolver",
  "engine",
  "output",
  "threshold",
];

const THRESHOLD_REQUIRE_FLAGS = [
  "require_schema_valid",
  "require_repeatability_pass",
  "require_mutation_equivalent",
  "require_producer_reconciliation_pass",
];
const THRESHOLD_FIELDS = [
  "minimum_repository_verified_percentage",
  ...THRESHOLD_REQUIRE_FLAGS,
];

function fail(reason) {
  throw new ConfigError(reason);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value === "") {
    fail(`${label} must be a non-empty string`);
  }
}

function validateSingleToken(value, label) {
  requireNonEmptyString(value, label);
  if (/[@\/\s]/.test(value)) {
    fail(`${label} must be a single token (no '@', '/', whitespace)`);
  }
}

function validateRevision(rev) {
  requireNonEmptyString(rev, "source_revision");
  if (!REVISION_RE.test(rev)) {
    fail("source_revision must be 7-64 lowercase hex chars");
  }
}

function stripLeadingDotSlash(p) {
  return p.startsWith("./") ? p.slice(2) : p;
}

function validateRelativePath(value, label) {
  requireNonEmptyString(value, label);
  if (value.includes("\0")) {
    fail(`${label} contains NUL`);
  }
  if (value[0] === "/") {
    fail(`${label} must be relative (no leading slash)`);
  }
  const segments = value.split("/");
  for (const seg of segments) {
    if (seg === "") {
      fail(`${label} has empty segment (no '//' or trailing '/')`);
    }
    if (seg === "." || seg === "..") {
      fail(`${label} has forbidden '${seg}' segment`);
    }
    if (/\s/.test(seg)) {
      fail(`${label} contains whitespace`);
    }
    for (const ch of FORBIDDEN_SEGMENT_CHARS) {
      if (seg.includes(ch)) {
        fail(`${label} contains reserved '${ch}'`);
      }
    }
  }
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function validateResolver(resolver, logicalRepo) {
  requireObject(resolver, "resolver");
  const path = resolver[logicalRepo];
  if (typeof path !== "string" || path === "") {
    fail(`resolver must map logical_repo '${logicalRepo}' to a non-empty path`);
  }
  if (PLACEHOLDER_RE.test(path)) {
    fail(`resolver path for '${logicalRepo}' has an unresolved placeholder`);
  }
  if (path.includes("\0")) {
    fail(`resolver path for '${logicalRepo}' contains NUL`);
  }
  if (path[0] !== "/") {
    fail(`resolver path for '${logicalRepo}' must be absolute (machine path)`);
  }
}

function validateEngine(engine) {
  requireObject(engine, "engine");
  requireNonEmptyString(engine.name, "engine.name");
  validateSingleToken(engine.profile, "engine.profile");
  requireNonEmptyString(engine.root, "engine.root");
  validateRelativePath(stripLeadingDotSlash(engine.root), "engine.root");
}

function validateThreshold(threshold) {
  requireObject(threshold, "threshold");
  for (const field of THRESHOLD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(threshold, field)) {
      fail(`threshold missing required field '${field}'`);
    }
  }
  for (const key of Object.keys(threshold)) {
    if (!THRESHOLD_FIELDS.includes(key)) {
      // additionalProperties: false — an unknown key (typo, future flag) must
      // not be silently ignored, otherwise the gate policy is silently relaxed.
      fail(`threshold has unknown property '${key}'`);
    }
  }
  const min = threshold.minimum_repository_verified_percentage;
  if (typeof min !== "number" || !Number.isFinite(min) || min < 0 || min > 100) {
    fail("threshold.minimum_repository_verified_percentage must be a finite number in [0, 100]");
  }
  for (const flag of THRESHOLD_REQUIRE_FLAGS) {
    if (typeof threshold[flag] !== "boolean") {
      fail(`threshold.${flag} must be a boolean`);
    }
  }
}

function parseJson(configText) {
  if (typeof configText !== "string") {
    fail("configText must be a string");
  }
  if (configText.trim() === "") {
    fail("configText is empty");
  }
  try {
    return JSON.parse(configText);
  } catch (err) {
    fail(`malformed JSON: ${err.message}`);
  }
}

export function loadConfig({ configText, cwd }) {
  if (typeof cwd !== "string" || cwd === "") {
    fail("cwd must be a non-empty string");
  }

  const raw = parseJson(configText);
  requireObject(raw, "config root");

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) {
      fail(`missing required field '${field}'`);
    }
  }

  validateSingleToken(raw.namespace, "namespace");
  validateSingleToken(raw.logical_repo, "logical_repo");
  validateRevision(raw.source_revision);
  validateResolver(raw.resolver, raw.logical_repo);
  validateEngine(raw.engine);
  validateThreshold(raw.threshold);

  requireNonEmptyString(raw.output, "output");
  const outputRel = stripLeadingDotSlash(raw.output);
  validateRelativePath(outputRel, "output");

  const cfg = {
    namespace: raw.namespace,
    logical_repo: raw.logical_repo,
    source_revision: raw.source_revision,
    resolver: { ...raw.resolver },
    engine: {
      name: raw.engine.name,
      profile: raw.engine.profile,
      root: stripLeadingDotSlash(raw.engine.root),
    },
    threshold: {
      minimum_repository_verified_percentage: raw.threshold.minimum_repository_verified_percentage,
      require_schema_valid: raw.threshold.require_schema_valid,
      require_repeatability_pass: raw.threshold.require_repeatability_pass,
      require_mutation_equivalent: raw.threshold.require_mutation_equivalent,
      require_producer_reconciliation_pass: raw.threshold.require_producer_reconciliation_pass,
    },
    output: resolve(cwd, outputRel),
  };
  if (Object.prototype.hasOwnProperty.call(raw, "display_repo")) {
    if (typeof raw.display_repo !== "string" || raw.display_repo === "") {
      fail("display_repo must be a non-empty string when present");
    }
    cfg.display_repo = raw.display_repo;
  }
  return cfg;
}
