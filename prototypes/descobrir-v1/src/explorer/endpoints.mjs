/**
 * Parse Explorer endpoints.md → Service + Endpoint records and EXPOSES relations.
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

const SECTION_RE = /^##\s+([A-Za-z0-9_-]+)\s+[—–-].*$/;

function parseTableRows(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  // skip header + separator
  while (i < lines.length && !lines[i].trim().startsWith("|")) i++;
  if (i >= lines.length) return { rows, next: i };
  i++; // header
  if (i < lines.length && /^\|[\s-:|]+\|$/.test(lines[i].trim())) i++;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length >= 2) {
      rows.push({ cells, lineNo: i + 1 });
    }
    i++;
  }
  return { rows, next: i };
}

function stripTicks(s) {
  return s.replace(/^`+|`+$/g, "").trim();
}

/**
 * @returns {{ records: object[], relations: object[] }}
 */
export function parseEndpoints(ctx, byPath) {
  const art = findArtifact(byPath, "endpoints.md", ".claude/explorer/endpoints.md");
  if (!art) return { records: [], relations: [] };

  const lines = art.content.split("\n");
  const records = [];
  const relations = [];
  const services = new Map();

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(SECTION_RE);
    if (!m) {
      i++;
      continue;
    }
    const serviceName = m[1].toLowerCase();
    const sectionLine = i + 1;
    const sectionPathLines = extractPathLines(lines[i]);
    i++;

    if (!services.has(serviceName)) {
      const evidence = [
        rangeArtifactEvidence(ctx, art, sectionLine, sectionLine),
        ...repoEvidenceFromPathLines(ctx, sectionPathLines),
      ];
      const rec = makeRecord(ctx, {
        type: "Service",
        naturalKey: serviceName,
        name: serviceName,
        summary: `Service domain ${serviceName}`,
        attributes: { domain: serviceName },
        evidence,
      });
      services.set(serviceName, rec);
      records.push(rec);
    }

    const { rows, next } = parseTableRows(lines, i);
    i = next;

    for (const { cells, lineNo } of rows) {
      const method = stripTicks(cells[0]).toUpperCase();
      const path = stripTicks(cells[1]);
      if (!method || !path.startsWith("/")) continue;
      const handler = cells[2] ? stripTicks(cells[2]) : "";
      const auth = cells[3] ? stripTicks(cells[3]) : "";
      const description = cells[4] ?? "";
      const naturalKey = `${method}:${path}`;
      const rowEvidence = [rangeArtifactEvidence(ctx, art, lineNo, lineNo)];
      const endpoint = makeRecord(ctx, {
        type: "Endpoint",
        naturalKey,
        name: `${method} ${path}`,
        summary: description || `${method} ${path}`,
        attributes: { method, path, handler, auth, service: serviceName },
        evidence: rowEvidence,
      });
      records.push(endpoint);

      const serviceId = services.get(serviceName).id;
      relations.push(
        makeRelation(ctx, {
          relationType: "EXPOSES",
          fromRecord: serviceId,
          toRecord: endpoint.id,
          evidence: [rangeArtifactEvidence(ctx, art, lineNo, lineNo)],
        }),
      );
    }
  }

  // Ensure service always has at least full-file artifact ref if somehow empty evidence
  for (const rec of records) {
    if (!rec.evidence.some((e) => e.kind === "artifact")) {
      rec.evidence.unshift(fullArtifactEvidence(ctx, art));
    }
  }

  return { records, relations };
}
