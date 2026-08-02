/**
 * Parse Explorer database.md → Table records + PERSISTS_TO relations.
 */
import { canonicalRecordId } from "../canonical-id.mjs";
import {
  extractPathLines,
  findArtifact,
  makeRecord,
  makeRelation,
  rangeArtifactEvidence,
  repoEvidenceFromPathLines,
} from "./common.mjs";

const DOMAIN_HEADING_RE = /^###\s+([A-Za-z0-9_-]+)\s*(?:\(([^)]+)\))?/;

function stripTicks(s) {
  return s.replace(/^`+|`+$/g, "").trim();
}

/**
 * @returns {{ records: object[], relations: object[] }}
 */
export function parseDatabase(ctx, byPath) {
  const art = findArtifact(byPath, "database.md", ".claude/explorer/database.md");
  if (!art) return { records: [], relations: [] };

  const lines = art.content.split("\n");
  const records = [];
  const relations = [];
  let domain = null;
  let domainRepoEvidence = [];
  let domainLine = 1;

  let i = 0;
  while (i < lines.length) {
    const hm = lines[i].match(DOMAIN_HEADING_RE);
    if (hm) {
      domain = hm[1].toLowerCase();
      domainLine = i + 1;
      const pathLines = extractPathLines(lines[i]);
      domainRepoEvidence = repoEvidenceFromPathLines(ctx, pathLines);
      i++;
      continue;
    }

    if (domain && lines[i].trim().startsWith("|")) {
      // skip header + separator
      i++;
      if (i < lines.length && /^\|[\s-:|]+\|$/.test(lines[i].trim())) i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        const lineNo = i + 1;
        const tableName = stripTicks(cells[0] ?? "");
        const content = cells[1] ?? "";
        i++;
        if (!tableName || /^tabela$/i.test(tableName)) continue;

        const naturalKey = `${domain}:${tableName}`;
        const tableId = canonicalRecordId("Table", naturalKey);
        const evidence = [
          rangeArtifactEvidence(ctx, art, lineNo, lineNo),
          ...domainRepoEvidence,
        ];
        records.push(
          makeRecord(ctx, {
            type: "Table",
            naturalKey,
            name: tableName,
            summary: content || `Table ${tableName}`,
            attributes: { domain, table: tableName },
            evidence,
          }),
        );

        const serviceId = canonicalRecordId("Service", domain);
        relations.push(
          makeRelation(ctx, {
            relationType: "PERSISTS_TO",
            fromRecord: serviceId,
            toRecord: tableId,
            evidence: [
              rangeArtifactEvidence(ctx, art, domainLine, lineNo),
              ...domainRepoEvidence,
            ],
          }),
        );
      }
      continue;
    }

    i++;
  }

  return { records, relations };
}
