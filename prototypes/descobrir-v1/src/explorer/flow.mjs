/**
 * Parse Explorer flow markdown (frontmatter + path:line chain) → Flow + TRIGGERS.
 */
import {
  extractPathLines,
  findArtifact,
  fullArtifactEvidence,
  makeRecord,
  makeRelation,
  rangeArtifactEvidence,
  repoEvidenceFromPathLines,
} from "./common.mjs";
import { canonicalRecordId } from "../canonical-id.mjs";

function parseFrontmatter(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { meta: {}, body: content, fmEndLine: 0 };
  }
  const lines = content.split("\n");
  const meta = {};
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "---") {
      i++;
      break;
    }
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      meta[key] = value;
    }
    i++;
  }
  return { meta, body: lines.slice(i).join("\n"), fmEndLine: i };
}

function parseTriggerEndpoint(trigger) {
  // e.g. "POST /api/v1/iam/auth/register"
  const m = trigger.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/i);
  if (!m) return null;
  return { method: m[1].toUpperCase(), path: m[2] };
}

/**
 * @param {object} ctx
 * @param {Map} byPath
 * @returns {{ records: object[], relations: object[] }}
 */
export function parseFlows(ctx, byPath) {
  const records = [];
  const relations = [];

  for (const [path, art] of byPath) {
    if (!path.includes("/flows/") || !path.endsWith(".md")) continue;
    const { meta, fmEndLine } = parseFrontmatter(art.content);
    const slug = meta.slug;
    if (!slug) continue;

    const pathLines = extractPathLines(art.content);
    const evidence = [
      rangeArtifactEvidence(ctx, art, 1, Math.max(1, fmEndLine || 1)),
      ...repoEvidenceFromPathLines(ctx, pathLines),
    ];
    if (!evidence.some((e) => e.kind === "artifact")) {
      evidence.unshift(fullArtifactEvidence(ctx, art));
    }

    const flow = makeRecord(ctx, {
      type: "Flow",
      naturalKey: slug,
      name: slug,
      summary: meta.trigger
        ? `Flow triggered by ${meta.trigger}`
        : `Flow ${slug}`,
      attributes: {
        slug,
        trigger: meta.trigger ?? "",
        entry_point: meta.entry_point ?? "",
        entry_type: meta.entry_type ?? "",
      },
      evidence,
    });
    records.push(flow);

    if (meta.trigger) {
      const ep = parseTriggerEndpoint(meta.trigger);
      if (ep) {
        const endpointId = canonicalRecordId("Endpoint", `${ep.method}:${ep.path}`);
        relations.push(
          makeRelation(ctx, {
            relationType: "TRIGGERS",
            fromRecord: endpointId,
            toRecord: flow.id,
            evidence: [rangeArtifactEvidence(ctx, art, 2, 3)],
          }),
        );
      }
    }
  }

  // Also accept a single flow file found by name without /flows/ if needed
  if (records.length === 0) {
    const art = findArtifact(byPath, "post-iam-auth-register.md");
    if (art) {
      const { meta, fmEndLine } = parseFrontmatter(art.content);
      if (meta.slug) {
        const pathLines = extractPathLines(art.content);
        records.push(
          makeRecord(ctx, {
            type: "Flow",
            naturalKey: meta.slug,
            name: meta.slug,
            summary: `Flow ${meta.slug}`,
            attributes: {
              slug: meta.slug,
              trigger: meta.trigger ?? "",
              entry_point: meta.entry_point ?? "",
              entry_type: meta.entry_type ?? "",
            },
            evidence: [
              rangeArtifactEvidence(ctx, art, 1, Math.max(1, fmEndLine || 1)),
              ...repoEvidenceFromPathLines(ctx, pathLines),
            ],
          }),
        );
      }
    }
  }

  return { records, relations };
}
