# Database

> SYNTHETIC FIXTURE — structural shape only.
> No connection strings, DSNs, credentials, or hostnames.
> Schema bootstrap is per-domain store setup (idempotent table create).

## Tables by domain

### iam (`domains/iam/store/store.go:15`)
| Tabela | Conteúdo |
|--------|----------|
| `iam_tenants` | Tenants |
| `iam_users` | Users (password hash only; no plaintext) |
| `iam_user_tenants` | User↔tenant role link |
| `iam_user_tokens` | Short-lived verify tokens (no token values listed) |

## Cross-domain links (by convention — no FKs)

- `tenant_id` referenced by other domains when present

## Declared counts (fixture)

- domains with tables: 1
- tables listed: 4
