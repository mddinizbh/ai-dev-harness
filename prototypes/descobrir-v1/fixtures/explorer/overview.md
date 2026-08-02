# Overview — synthetic pilot

> SYNTHETIC FIXTURE — structural shape of an Explorer overview.
> Not a copy of any real Native Artifact body. No secrets, env, or absolute paths.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Language | Go (module placeholder) |
| HTTP/API | Generic OpenAPI-first HTTP layer |
| Database | Relational store via driver pool (DSN never recorded here) |
| Messaging | Single logical topic; dispatch by event type |
| Auth | Token-based; no key material in fixtures |

## Folder structure (logical)

```
repo/
├── domains/
│   └── iam/          # identity domain — auth, tenants, users
├── pkg/
│   ├── events/       # typed event bus + adapters
│   └── infra/        # wrappers (http, db, log)
```

## Architecture: mono-services

Each domain compiles to its own binary with the same skeleton:

1. Collect flags/config (no env values in fixture)
2. Open DB pool + optional `store.Setup`
3. Wire controller and HTTP service
4. Optional event processor
5. Operational server (health/metrics)

## Declared counts (fixture)

- domains sketched: 1
- flows referenced: 1 (`post-iam-auth-register`)
