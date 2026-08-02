# Repository Reference — Descobrir v1

Machine-independent URI that points at source code evidence for a pinned logical revision.

This document is the normative companion to the `kind: "repository"` evidence arm in `knowledge-record.schema.json` and `relation.schema.json`.

## Grammar

```
repo://<logical>@<revision>/<relative-path>#L<start>-L<end>
```

| Segment | Meaning | Constraints |
|---|---|---|
| `repo://` | Fixed scheme | Literal, lowercase |
| `<logical>` | Logical repository identity | Non-empty. No `@`, no whitespace. Independent of machine path. |
| `@` | Separator | Literal |
| `<revision>` | Logical VCS revision | Non-empty. No `/`, no whitespace. **Not** restricted to 40-char hex — any VCS revision string is allowed. |
| `/` | Path introducer | Literal; the first `/` after `@<revision>` starts the path |
| `<relative-path>` | File path inside the repository | One or more segments separated by `/`. See Path segment rules. |
| `#L<start>-L<end>` | Inclusive 1-based line range | `<start>` and `<end>` are integers `>= 1` (no zero). `<end>` MUST be `>= <start>`. |

Whitespace is forbidden anywhere in the URI.

### Path segment rules (after structural parse)

After splitting on scheme / `@` / first path `/` / `#`, each path segment MUST:

1. Be non-empty (no `//`).
2. Not be exactly `.` or `..`.
3. Contain no `/` or `\` (separators are only the structural `/` between segments).
4. Contain no whitespace and no NUL.
5. Contain **no** reserved characters `%`, `?`, `#`, `@`.

**v1 prohibits percent-encoding** inside path segments rather than decoding it. Producers MUST NOT emit `%XX` sequences in path segments. Verifiers MUST reject any path segment containing `%`, `?`, `#`, or `@` — they do **not** percent-decode and re-parse.

### Schema pattern (machine check)

`knowledge-record.schema.json` and `relation.schema.json` enforce the structural grammar with this regex:

```
^repo://[^@/\s]+@[^/\s]+/(?:(?!\.{1,2}(?:/|$))[^\\/#\s%@?]+)(?:/(?!\.{1,2}(?:/|$))[^\\/#\s%@?]+)*#L[1-9][0-9]*-L[1-9][0-9]*$
```

Path is one or more non-empty segments. Each segment forbids the exact names `.` and `..` (so leading `./`, leading `../`, mid `/../`, and mid `/./` all fail). Segments also forbid `\`, `/`, `#`, whitespace, `%`, `?`, and `@`, which blocks backslashes, double slashes, absolute-style paths, percent-encoding, and reserved characters after the revision separator.

What the pattern rejects automatically: empty logical/revision, whitespace, absolute-style path (`//…` after revision), backslashes, `.` / `..` segments, percent-encoded segments, reserved characters `% ? # @` in path, missing or incomplete `#L…` fragments, and zero line bounds (`#L0-…`).

What remains a producer invariant (documented, not fully expressible in a single regex): `end_line >= start_line` (e.g. reject `#L10-L9` in the adapter even though both sides are positive); no NUL bytes (JSON strings already cannot embed raw NUL in normal interchange, but filesystem reads must still reject NUL in paths).

## Normalization

Producers MUST normalize before emitting a URI:

1. **Logical identity** — use the project’s stable logical repo id (not a clone path, not a remote URL, not a filesystem absolute path). If a display name contains `/`, normalize to a single logical token agreed by the Project Profile (for example hyphenation: display `nori/cloud` → logical `nori-cloud`). The URI parser treats everything between `repo://` and the first `@` as `<logical>`.
2. **Revision** — use the exact pinned revision string of the load (`source_revision`). Do not substitute branch names, `HEAD`, or working-tree aliases.
3. **Path** — repository-relative, POSIX separators (`/`), no leading `./`, no duplicate `//`, no trailing slash for files, Unicode NFC. **No percent-encoding.** If the on-disk name would require reserved characters `% ? # @` or whitespace, do not emit a Repository Reference for that path; keep the record as `hipótese` with Artifact Reference only (or a safe alternate anchor if one exists).
4. **Line range** — 1-based, inclusive. A single line uses equal bounds (`#L113-L113`). Do not use 0-based indices. Do not omit the end bound.
5. **Case** — scheme is always `repo://` lowercase. Path case follows the repository’s canonical tree at `<revision>` (case-sensitive comparison for identity).

Normalization MUST be deterministic: the same logical inputs always yield the same URI string.

## Escaping

- **v1: no percent-encoding in path segments.** Prefer paths that need no escaping.
- Do not percent-encode `/` path separators (separators are structural only).
- Do not encode the scheme, `@` revision separator, or `#L…-L…` fragment markers.
- Verifiers MUST **not** percent-decode path segments. Presence of `%` is a hard reject.

## Line ranges

| Form | Meaning |
|---|---|
| `#L10-L10` | Only line 10 |
| `#L10-L20` | Lines 10 through 20 inclusive |
| `#L1-L1` | First line of the file |

Rules:

- `start_line >= 1`, `end_line >= start_line`.
- Ranges refer to the file content **at `<revision>`**, not the working tree.
- Empty files cannot host a valid range; producers MUST fall back to `hipótese` when no line can be cited.
- Artifact evidence uses a structured `{start_line,end_line}` object instead of this fragment; only repository evidence uses `#Lx-Ly`.

## Examples

Valid:

```
repo://nori-cloud@633d3a5d16c165073ede2b2248bae708483f2efe/domains/iam/controller/service_register.go#L113-L113
```

```
repo://billing-api@v1.4.2/src/main/java/com/example/ChargeService.java#L40-L88
```

```
repo://platform-tf@plan-2026.03/modules/network/main.tf#L1-L25
```

```
repo://docs-site@release_7/content/guides/onboarding.md#L3-L3
```

The first example is illustrative only (pilot repository: display `nori/cloud`, logical identity `nori-cloud`). It is **not** a schema constant and MUST NOT be hardcoded into generic validators.

## Rejection cases

Reject (do not emit; mark the record `hipótese` if no alternative anchor exists):

| Bad URI | Reason |
|---|---|
| `repo://nori-cloud/domains/iam/x.go#L1-L1` | Missing `@<revision>` |
| `repo://nori-cloud@633d3a5/domains/iam/x.go` | Missing `#Lx-Ly` fragment |
| `repo://nori-cloud@633d3a5/domains/iam/x.go#L0-L1` | Line numbers must be `>= 1` |
| `repo://nori-cloud@633d3a5/domains/iam/x.go#L10-L9` | `end` must be `>= start` |
| `repo://nori-cloud@633d3a5//domains/iam/x.go#L1-L1` | Empty path segment / absolute-style path |
| `repo:///nori-cloud@633d3a5/x.go#L1-L1` | Empty logical identity |
| `repo://nori-cloud@/x.go#L1-L1` | Empty revision |
| `repo://nori-cloud@633d3a5/../secret.go#L1-L1` | `..` segment forbidden |
| `repo://nori-cloud@633d3a5/./x.go#L1-L1` | `.` segment forbidden |
| `repo://nori-cloud@633d3a5/C:\repo\x.go#L1-L1` | Absolute / Windows path forbidden |
| `/Users/me/proj/x.go` | Not a `repo://` URI; machine path is never canonical |
| `file:///Users/me/proj/x.go` | Wrong scheme |
| `repo://nori-cloud@HEAD/x.go#L1-L1` | `HEAD` is not a pinned logical revision for Descobrir loads |
| `repo://nori-cloud@633d3a5/x.go#L1-` | Incomplete fragment |
| `repo://nori cloud@633d3a5/x.go#L1-L1` | Whitespace forbidden |
| `repo://nori-cloud@633d3a5/x%20y.go#L1-L1` | Percent-encoding forbidden in v1 path segments |
| `repo://nori-cloud@633d3a5/x?y.go#L1-L1` | Reserved character `?` in path segment |
| `repo://nori-cloud@633d3a5/foo@bar.go#L1-L1` | Reserved character `@` in path segment |
| `repo://nori/cloud@633d3a5/x.go#L1-L1` | Logical id must be a single token (use `nori-cloud`, not display `nori/cloud`) |

## Relationship to status

- A resolvable Repository Reference verified against file bytes at `<revision>` is required for status `comprovado` on that same record/relation.
- Todo Knowledge Record e Relation emitido por Descobrir inclui ao menos uma Artifact Reference (`kind: "artifact"`); essa evidência, **sozinha**, nunca justifica `comprovado`.
- If the path does not exist at `<revision>`, or the line range is out of bounds for that revision’s file, the reference is unresolved and the record stays `hipótese` (listed under coverage `unresolved_ids`).

## Non-goals

- This URI does not encode machine clone paths (Repository Resolvers map `<logical>` → local path per Contexto; machine paths stay only in ephemeral resolver config).
- This URI does not encode storage technology, engine name, or profile.
- This URI is not a Canonical ID; record identity remains `type:natural_key` without revision or path.
- Generic schemas MUST NOT hardcode pilot logical ids (e.g. `nori-cloud`).
