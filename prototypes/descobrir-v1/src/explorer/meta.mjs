/**
 * Parse Explorer .meta.yaml declared counts (profile-specific, minimal).
 */
import { findArtifact } from "./common.mjs";

/**
 * Extract counts block from .meta.yaml fixture shape.
 * @returns {{ endpoints: number, consumers: number, producers: number, flows: number, insights: number } | null}
 */
export function parseDeclaredCounts(byPath) {
  const art = findArtifact(
    byPath,
    ".meta.yaml",
    ".claude/explorer/.meta.yaml",
    "meta.yaml",
  );
  if (!art) return null;

  const counts = {
    endpoints: 0,
    consumers: 0,
    producers: 0,
    flows: 0,
    insights: 0,
  };
  let inCounts = false;
  for (const raw of art.content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^counts:\s*$/.test(line)) {
      inCounts = true;
      continue;
    }
    if (inCounts) {
      if (/^\S/.test(line) && !/^\s/.test(line)) {
        break;
      }
      const m = line.match(/^\s+(endpoints|consumers|producers|flows|insights):\s*(\d+)\s*$/);
      if (m) {
        counts[m[1]] = Number(m[2]);
      }
    }
  }
  return counts;
}

export const ADAPTER_PROFILE = {
  engine: "explorer",
  recordTypes: {
    Service: {
      naturalKey: "domain name lowercased (e.g. iam)",
    },
    Endpoint: {
      naturalKey: "METHOD:/path (e.g. POST:/api/v1/iam/auth/register)",
    },
    Flow: {
      naturalKey: "flow slug from frontmatter (e.g. post-iam-auth-register)",
    },
    Event: {
      naturalKey:
        "normalized event type path; optional cloud/domains/ prefix stripped; .Event → .event",
    },
    Table: {
      naturalKey: "domain:table_name (e.g. iam:iam_tenants)",
    },
  },
  relationTypes: {
    EXPOSES: {
      description: "Service exposes HTTP Endpoint",
    },
    TRIGGERS: {
      description: "Endpoint triggers Flow (from flow frontmatter trigger)",
    },
    PUBLISHES: {
      description: "Service publishes Event (producers table)",
    },
    CONSUMES: {
      description: "Service consumes Event (consumers table)",
    },
    PERSISTS_TO: {
      description: "Service persists to Table (database domain section)",
    },
  },
  gaps: [
    "overview.md prose is not parsed into factual records",
    "no live git verification — repository evidence stays hipótese",
    "profile-specific markdown shapes only; not a generic MD parser",
  ],
};
