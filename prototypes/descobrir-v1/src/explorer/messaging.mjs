/**
 * Parse Explorer producers.md + consumers.md → Event + PUBLISHES + CONSUMES.
 */
import { canonicalRecordId } from "../canonical-id.mjs";
import {
  extractPathLines,
  findArtifact,
  makeRecord,
  makeRelation,
  normalizeEventNaturalKey,
  rangeArtifactEvidence,
  repoEvidenceFromPathLines,
} from "./common.mjs";

function parseMarkdownTable(content) {
  const lines = content.split("\n");
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith("|")) {
      i++;
      continue;
    }
    // header
    i++;
    if (i < lines.length && /^\|[\s-:|]+\|$/.test(lines[i].trim())) i++;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      const cells = lines[i]
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length >= 1) {
        rows.push({ cells, lineNo: i + 1 });
      }
      i++;
    }
  }
  return rows;
}

function stripTicks(s) {
  return s.replace(/^`+|`+$/g, "").trim();
}

function serviceIdForDomain(domainHint) {
  // producers/consumers in fixture are IAM-scoped
  const d = (domainHint || "iam").toLowerCase();
  if (d.includes("iam")) return canonicalRecordId("Service", "iam");
  return canonicalRecordId("Service", d);
}

/**
 * @returns {{ records: object[], relations: object[] }}
 */
export function parseMessaging(ctx, byPath) {
  const recordsById = new Map();
  const relations = [];

  const producers = findArtifact(byPath, "producers.md", ".claude/explorer/producers.md");
  if (producers) {
    for (const { cells, lineNo } of parseMarkdownTable(producers.content)) {
      // Origem | Call site | Evento produzido | Consumido por
      if (cells.length < 3) continue;
      const origem = stripTicks(cells[0]);
      if (/^origem$/i.test(origem)) continue;
      const callSite = stripTicks(cells[1] ?? "");
      const eventRaw = stripTicks(cells[2] ?? "");
      if (!eventRaw || !eventRaw.includes("/")) continue;

      const naturalKey = normalizeEventNaturalKey(eventRaw);
      const eventId = canonicalRecordId("Event", naturalKey);
      const pathLines = extractPathLines(callSite);
      const rowEv = [rangeArtifactEvidence(ctx, producers, lineNo, lineNo)];
      const repoEv = repoEvidenceFromPathLines(ctx, pathLines);

      if (!recordsById.has(eventId)) {
        recordsById.set(
          eventId,
          makeRecord(ctx, {
            type: "Event",
            naturalKey,
            name: naturalKey,
            summary: `Event ${naturalKey}`,
            attributes: { event_type: naturalKey },
            evidence: [...rowEv, ...repoEv],
          }),
        );
      } else {
        const existing = recordsById.get(eventId);
        existing.evidence.push(...rowEv, ...repoEv);
      }

      const from = serviceIdForDomain(origem);
      relations.push(
        makeRelation(ctx, {
          relationType: "PUBLISHES",
          fromRecord: from,
          toRecord: eventId,
          evidence: [...rowEv, ...repoEv],
        }),
      );
    }
  }

  const consumers = findArtifact(byPath, "consumers.md", ".claude/explorer/consumers.md");
  if (consumers) {
    // Domain hint from headings like ### iam-mono-service
    let domainHint = "iam";
    const heading = consumers.content.match(/^###\s+([a-z0-9_-]+)/m);
    if (heading) domainHint = heading[1];

    for (const { cells, lineNo } of parseMarkdownTable(consumers.content)) {
      // Evento (tipo) | Handler | Efeito
      if (cells.length < 1) continue;
      const eventRaw = stripTicks(cells[0] ?? "");
      if (!eventRaw || /^evento/i.test(eventRaw)) continue;
      if (!eventRaw.includes("/")) continue;

      const naturalKey = normalizeEventNaturalKey(eventRaw);
      const eventId = canonicalRecordId("Event", naturalKey);
      const rowEv = [rangeArtifactEvidence(ctx, consumers, lineNo, lineNo)];
      // Registry line may have path:line above the table
      const nearby = extractPathLines(consumers.content);
      const repoEv = repoEvidenceFromPathLines(ctx, nearby);

      if (!recordsById.has(eventId)) {
        recordsById.set(
          eventId,
          makeRecord(ctx, {
            type: "Event",
            naturalKey,
            name: naturalKey,
            summary: `Event ${naturalKey}`,
            attributes: { event_type: naturalKey },
            evidence: [...rowEv, ...repoEv],
          }),
        );
      } else {
        const existing = recordsById.get(eventId);
        existing.evidence.push(...rowEv);
      }

      relations.push(
        makeRelation(ctx, {
          relationType: "CONSUMES",
          fromRecord: serviceIdForDomain(domainHint),
          toRecord: eventId,
          evidence: rowEv,
        }),
      );
    }
  }

  return { records: [...recordsById.values()], relations };
}
