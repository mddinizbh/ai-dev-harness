# Consumers (message bus and in-process)

> SYNTHETIC FIXTURE — structural shape only.
> One logical topic; each mono-service uses its own consumer group and dispatches by event type.

## Message bus (active)

### iam-mono-service (`domains/iam/cmd/iam-mono-service/main.go:20`)
Registry: `domains/iam/services/processor/service.go:10`

| Evento (tipo) | Handler | Efeito |
|---------------|---------|--------|
| `cloud/domains/iam/events/register/v1.Event` | `Service.HandleRegister` | Renders confirmation template and sends notification |

Upstream: IAM register endpoint. Downstream: notification adapter (no credentials in fixture).

## Declared counts (fixture)

- consumers: 1
