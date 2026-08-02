# Endpoints HTTP

> SYNTHETIC FIXTURE — structural shape only. No secrets, env values, or real payloads.
> Handlers registered via a generic HTTP framework in each domain service file.

## IAM — `:8085` (`domains/iam/services/api/service.go`)

| Método | Path | Handler | Auth | Descrição |
|--------|------|---------|------|-----------|
| POST | `/api/v1/iam/auth/register` | `Service.Register` | apiKey | Registers tenant + admin. Emits `register` event. Flow: [post-iam-auth-register](flows/post-iam-auth-register.md) |
| POST | `/api/v1/iam/auth/login` | `Service.Login` | pública | Login → session token |

## Declared counts (fixture)

- endpoints: 2
- domains listed: 1
