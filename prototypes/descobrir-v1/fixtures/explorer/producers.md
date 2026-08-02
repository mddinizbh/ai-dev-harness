# Producers

> SYNTHETIC FIXTURE — structural shape only.
> Producer adapter publishes typed events to a single logical topic; key = event type.

## Message bus (active)

| Origem | Call site | Evento produzido | Consumido por |
|--------|-----------|------------------|---------------|
| IAM register | `domains/iam/controller/service_register.go:60` | `iam/events/register/v1.Event` | iam processor → notification |

## Declared counts (fixture)

- producers: 1
