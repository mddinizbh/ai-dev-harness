---
slug: post-iam-auth-register
trigger: POST /api/v1/iam/auth/register
entry_point: iam api.Service.Register
entry_type: http
---

# Register tenant + admin

> SYNTHETIC FIXTURE — structural shape only. Path:line refs point at fixture source.

## Trigger
`POST /api/v1/iam/auth/register` (auth: api key header name only) — `domains/iam/services/api/service.go:12`

## Description
Creates a new tenant with an admin user, issues a verification token record, and emits an async register event on the message bus.

## Chain
1. `domains/iam/services/api/service.go:12` — HTTP registration → handler `Service.Register`
2. `domains/iam/controller/service_register.go:41` — `controller.Service.Register`: transaction creates tenant, user, user↔tenant link, and verify token
3. `domains/iam/controller/service_register.go:60` — `producer.Produce(register.New(...))` → `iam/events/register/v1.Event`
4. `domains/iam/services/processor/service.go:10` — `HandleRegister` renders template
5. notification adapter — send (kind email); transport details omitted from fixture

## Hotspots on path
n/a — synthetic fixture.

## Notes
- Callback URL shape is request-derived; no real URLs stored here.
- Same structural pattern may apply to related auth endpoints in a full profile.
