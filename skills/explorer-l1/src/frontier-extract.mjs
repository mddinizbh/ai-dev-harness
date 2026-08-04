/**
 * Deterministic frontier extraction from a Git repo at a pinned revision.
 *
 * Sources (no LLM):
 * - Spring MVC annotations → HTTP inbound
 * - RestTemplate/WebClient URL string templates + @Value base URL → HTTP outbound
 * - application.yml keys that look like service base URLs → config bindings
 *
 * Each fact points at file:line evidence in the source repo.
 */

import { execFileSync } from "node:child_process";
import { FrontierError } from "./errors.mjs";
import { contractKey, normalizeHttpPath, normalizeMethod } from "./path-normalize.mjs";

/**
 * @typedef {{
 *   kind: "http_inbound" | "http_outbound" | "config_binding",
 *   namespace: string,
 *   logical_repo: string,
 *   source_revision: string,
 *   method?: string,
 *   path?: string,
 *   contract_key?: string,
 *   config_key?: string,
 *   file: string,
 *   line: number,
 *   evidence_snippet: string,
 *   id: string,
 * }} FrontierFact
 */

/**
 * @param {string} repoPath
 * @param {string} revision
 * @param {string} path
 * @returns {string|null}
 */
function gitShow(repoPath, revision, path) {
  try {
    return execFileSync("git", ["-C", repoPath, "show", `${revision}:${path}`], {
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @param {string} revision
 * @returns {string[]}
 */
function listSourceFiles(repoPath, revision) {
  const out = execFileSync(
    "git",
    ["-C", repoPath, "ls-tree", "-r", "--name-only", revision],
    { encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (p) =>
        p &&
        !p.includes("src/test/") &&
        !p.includes("/test/") &&
        (/\.(kt|java|yml|yaml|properties)$/i.test(p) ||
          /application.*\.(yml|yaml|properties)$/i.test(p)),
    );
}

/**
 * @param {string} text
 * @param {string} file
 * @param {{ namespace: string, logical_repo: string, source_revision: string }} meta
 * @returns {FrontierFact[]}
 */
/**
 * True when a Spring/Kotlin property key looks like a service base URL binding.
 * @param {string} key
 */
function isServiceUrlConfigKey(key) {
  return /URL|URI|HOST|ENDPOINT|BASE/i.test(key);
}

/**
 * Map local field/param names → config keys from @Value in this file.
 * Handles Kotlin constructor params and Java fields.
 * @param {string[]} lines
 * @returns {Map<string, string>}
 */
/** Match @Value("${KEY}") allowing Kotlin string escape \${KEY}. */
const VALUE_PROP_RE = /@Value\s*\(\s*["']\\?\$\{([^}]+)\}["']\s*\)/;

function collectValueBindings(lines) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // @Value("${KEY}") ... name  OR same-line Kotlin constructor param
    const same = line.match(
      /@Value\s*\(\s*["']\\?\$\{([^}]+)\}["']\s*\)\s*(?:private\s+|val\s+|var\s+|final\s+)*(?:[\w.<>,?\s]+?\s+)?(\w+)\s*[,)=:]/,
    );
    if (same && isServiceUrlConfigKey(same[1])) {
      map.set(same[2], same[1]);
      continue;
    }
    const valueOnly = line.match(VALUE_PROP_RE);
    if (!valueOnly || !isServiceUrlConfigKey(valueOnly[1])) continue;
    // look ahead a few lines for the identifier
    for (let j = i; j < Math.min(lines.length, i + 4); j += 1) {
      const id =
        lines[j].match(
          /(?:private\s+|val\s+|var\s+|final\s+)*(?:[\w.<>,?\s]+?\s+)?(\w+)\s*[,)=:;]/,
        ) || lines[j].match(/(\w+)\s*[:=]/);
      if (id && !["String", "val", "var", "private", "final"].includes(id[1])) {
        map.set(id[1], valueOnly[1]);
        break;
      }
    }
  }
  return map;
}

/**
 * Resolve config_key for an outbound URL line using $var / ${var} base prefix.
 * @param {string} line
 * @param {Map<string, string>} valueBindings
 * @returns {string|undefined}
 */
function resolveOutboundConfigKey(line, valueBindings) {
  // Prefer longest matching bound field name appearing as $name in the line
  /** @type {string|undefined} */
  let best;
  let bestLen = 0;
  for (const [varName, configKey] of valueBindings) {
    const re = new RegExp(`\\$${varName}\\b`);
    if (re.test(line) && varName.length > bestLen) {
      best = configKey;
      bestLen = varName.length;
    }
  }
  if (best) return best;
  // direct ${PROVIDERCONTROLLER_API_URL} in string
  for (const m of line.matchAll(/\$\{([A-Z][A-Z0-9_]+)\}/g)) {
    if (isServiceUrlConfigKey(m[1])) return m[1];
  }
  return undefined;
}

function extractFromSource(text, file, meta) {
  /** @type {FrontierFact[]} */
  const facts = [];
  const lines = text.split(/\r?\n/);
  const valueBindings = collectValueBindings(lines);

  // Pass with classPrefix tracking (Spring @RequestMapping + Micronaut @Controller)
  let classPrefix = "";
  let pendingClassMap = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const rm = line.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
    if (rm) pendingClassMap = rm[1];
    const ctrl = line.match(/@Controller\s*\(\s*(?:value\s*=\s*|uri\s*=\s*)?["']([^"']+)["']/);
    if (ctrl) pendingClassMap = ctrl[1];
    if (pendingClassMap && /\b(class|interface)\b/.test(line)) {
      classPrefix = pendingClassMap;
      pendingClassMap = null;
    }

    // Spring *Mapping first; then Micronaut @Get/@Post (negative lookahead avoids @GetMapping)
    const methodAnns = [
      ["GET", /@GetMapping\s*(?:\((?:value\s*=\s*)?["']([^"']*)["']\))?/],
      ["POST", /@PostMapping\s*(?:\((?:value\s*=\s*)?["']([^"']*)["']\))?/],
      ["PUT", /@PutMapping\s*(?:\((?:value\s*=\s*)?["']([^"']*)["']\))?/],
      ["DELETE", /@DeleteMapping\s*(?:\((?:value\s*=\s*)?["']([^"']*)["']\))?/],
      ["PATCH", /@PatchMapping\s*(?:\((?:value\s*=\s*)?["']([^"']*)["']\))?/],
      ["GET", /@Get(?!Mapping)\s*(?:\(\s*(?:uri\s*=\s*|value\s*=\s*)?["']([^"']*)["']\s*\))?/],
      ["POST", /@Post(?!Mapping)\s*(?:\(\s*(?:uri\s*=\s*|value\s*=\s*)?["']([^"']*)["']\s*\))?/],
      ["PUT", /@Put(?!Mapping)\s*(?:\(\s*(?:uri\s*=\s*|value\s*=\s*)?["']([^"']*)["']\s*\))?/],
      ["DELETE", /@Delete(?!Mapping)\s*(?:\(\s*(?:uri\s*=\s*|value\s*=\s*)?["']([^"']*)["']\s*\))?/],
      ["PATCH", /@Patch(?!Mapping)\s*(?:\(\s*(?:uri\s*=\s*|value\s*=\s*)?["']([^"']*)["']\s*\))?/],
    ];
    for (const [method, re] of methodAnns) {
      const m = line.match(re);
      if (!m) continue;
      const sub = m[1] || "";
      const full = joinPaths(classPrefix, sub);
      if (!full || full === "/") continue;
      const ck = contractKey(method, full);
      facts.push({
        kind: "http_inbound",
        namespace: meta.namespace,
        logical_repo: meta.logical_repo,
        source_revision: meta.source_revision,
        method: normalizeMethod(method),
        path: normalizeHttpPath(full),
        contract_key: ck,
        file,
        line: i + 1,
        evidence_snippet: line.trim().slice(0, 200),
        id: factId("in", meta, file, i + 1, ck),
      });
    }

    // RequestMapping on method with method= RequestMethod.POST
    const rmMethod = line.match(
      /@RequestMapping\s*\([^)]*value\s*=\s*["']([^"']+)["'][^)]*method\s*=\s*RequestMethod\.([A-Z]+)/,
    );
    if (rmMethod) {
      const full = joinPaths(classPrefix, rmMethod[1]);
      const method = rmMethod[2];
      const ck = contractKey(method, full);
      facts.push({
        kind: "http_inbound",
        namespace: meta.namespace,
        logical_repo: meta.logical_repo,
        source_revision: meta.source_revision,
        method: normalizeMethod(method),
        path: normalizeHttpPath(full),
        contract_key: ck,
        file,
        line: i + 1,
        evidence_snippet: line.trim().slice(0, 200),
        id: factId("in", meta, file, i + 1, ck),
      });
    }

    // @Value base URL → config_binding fact (Kotlin may escape \${...})
    const valueUrl = line.match(VALUE_PROP_RE);
    if (valueUrl && isServiceUrlConfigKey(valueUrl[1])) {
      facts.push({
        kind: "config_binding",
        namespace: meta.namespace,
        logical_repo: meta.logical_repo,
        source_revision: meta.source_revision,
        config_key: valueUrl[1],
        file,
        line: i + 1,
        evidence_snippet: line.trim().slice(0, 200),
        id: factId("cfg", meta, file, i + 1, valueUrl[1]),
      });
    }

    // Outbound path templates: "$base/api/..." or url = "$x/path"
    const outPaths = [
      ...line.matchAll(/["'`](\$\{?[\w.]+\}?\/[^"'`]+)["'`]/g),
      ...line.matchAll(/["'`](\/api\/[^"'`]+)["'`]/g),
      ...line.matchAll(/["'`](\/private\/[^"'`]+)["'`]/g),
    ];
    for (const om of outPaths) {
      const raw = om[1];
      // strip $var prefix for path part
      const pathPart = raw.replace(/^\$\{?[\w.]+\}?/, "") || raw;
      if (!pathPart.startsWith("/")) continue;
      if (pathPart.length < 4) continue;
      if (/\.(css|js|png|jpg)$/i.test(pathPart)) continue;
      const method = inferMethodNearby(lines, i);
      const ck = contractKey(method, pathPart);
      const configKey = resolveOutboundConfigKey(line, valueBindings);
      facts.push({
        kind: "http_outbound",
        namespace: meta.namespace,
        logical_repo: meta.logical_repo,
        source_revision: meta.source_revision,
        method: normalizeMethod(method),
        path: normalizeHttpPath(pathPart),
        contract_key: ck,
        ...(configKey ? { config_key: configKey } : {}),
        file,
        line: i + 1,
        evidence_snippet: line.trim().slice(0, 200),
        id: factId("out", meta, file, i + 1, ck),
      });
    }
  }

  // yaml config keys
  if (/\.(yml|yaml)$/i.test(file)) {
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^\s*([A-Z][A-Z0-9_]*(?:URL|URI|HOST|ENDPOINT))\s*:/);
      if (m) {
        facts.push({
          kind: "config_binding",
          namespace: meta.namespace,
          logical_repo: meta.logical_repo,
          source_revision: meta.source_revision,
          config_key: m[1],
          file,
          line: i + 1,
          evidence_snippet: lines[i].trim().slice(0, 200),
          id: factId("cfg", meta, file, i + 1, m[1]),
        });
      }
    }
  }

  return facts;
}

/**
 * @param {string[]} lines
 * @param {number} i
 */
function inferMethodNearby(lines, i) {
  const window = lines.slice(Math.max(0, i - 5), i + 1).join(" ");
  if (/\.postFor|PostMapping|POST\b|post\(/.test(window)) return "POST";
  if (/\.put\(|PutMapping|PUT\b/.test(window)) return "PUT";
  if (/\.delete\(|DeleteMapping|DELETE\b/.test(window)) return "DELETE";
  if (/\.patch\(|PatchMapping|PATCH\b/.test(window)) return "PATCH";
  return "GET";
}

/**
 * @param {string} a
 * @param {string} b
 */
function joinPaths(a, b) {
  const left = (a || "").replace(/\/$/, "");
  const right = (b || "").replace(/^\//, "");
  if (!left && !right) return "/";
  if (!left) return `/${right}`.replace(/\/{2,}/g, "/");
  if (!right) return left.startsWith("/") ? left : `/${left}`;
  return `${left.startsWith("/") ? left : `/${left}`}/${right}`.replace(/\/{2,}/g, "/");
}

/**
 * @param {string} kind
 * @param {{ namespace: string, logical_repo: string, source_revision: string }} meta
 * @param {string} file
 * @param {number} line
 * @param {string} key
 */
function factId(kind, meta, file, line, key) {
  const raw = `${meta.namespace}|${meta.logical_repo}|${meta.source_revision}|${kind}|${file}|${line}|${key}`;
  // short stable id without crypto dep issues
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return `ff:${kind}:${(h >>> 0).toString(16)}:${line}`;
}

/**
 * @param {{
 *   repoPath: string,
 *   revision: string,
 *   namespace: string,
 *   logical_repo: string,
 * }} input
 * @returns {FrontierFact[]}
 */
export function extractFrontierFromGit(input) {
  if (!input?.repoPath || !input.revision || !input.namespace || !input.logical_repo) {
    throw new FrontierError("repoPath, revision, namespace, logical_repo are required");
  }
  const meta = {
    namespace: input.namespace,
    logical_repo: input.logical_repo,
    source_revision: input.revision,
  };
  let files;
  try {
    files = listSourceFiles(input.repoPath, input.revision);
  } catch (err) {
    throw new FrontierError(`failed to list files at ${input.revision}`, { cause: err });
  }

  /** @type {FrontierFact[]} */
  const all = [];
  for (const file of files) {
    const text = gitShow(input.repoPath, input.revision, file);
    if (!text) continue;
    all.push(...extractFromSource(text, file, meta));
  }

  // dedupe by id
  const byId = new Map();
  for (const f of all) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Optional: also accept pre-built facts (tests).
 * @param {FrontierFact[]} facts
 */
export function dedupeFrontier(facts) {
  const byId = new Map();
  for (const f of facts) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
