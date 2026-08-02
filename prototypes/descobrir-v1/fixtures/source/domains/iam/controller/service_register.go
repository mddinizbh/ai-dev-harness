// SYNTHETIC FIXTURE — generic stand-in for path:line verification tests.
// Not production code. No secrets, DSNs, or proprietary payloads.
package controller

import "context"

// Service is a minimal stand-in for an IAM controller service.
type Service struct {
	store    Store
	producer Producer
}

// Store persists tenants and users for Register.
type Store interface {
	CreateTenant(ctx context.Context, name string) (string, error)
	CreateUser(ctx context.Context, email string) (string, error)
	LinkUser(ctx context.Context, userID, tenantID string) error
	CreateToken(ctx context.Context, userID string) error
}

// Producer emits domain events after successful register.
type Producer interface {
	Produce(ctx context.Context, event any) error
}

// RegisterRequest is the inbound register payload (fields only).
type RegisterRequest struct {
	TenantName string
	AdminEmail string
}

// RegisterResult is the outbound register result.
type RegisterResult struct {
	TenantID string
	UserID   string
}

// Register creates tenant + admin and emits a register event.
// Intentional anchors: body entry at L41; Produce at L60.
func (s *Service) Register(ctx context.Context, req RegisterRequest) (*RegisterResult, error) {
	tenantID, err := s.store.CreateTenant(ctx, req.TenantName)
	if err != nil {
		return nil, err
	}
	userID, err := s.store.CreateUser(ctx, req.AdminEmail)
	if err != nil {
		return nil, err
	}
	if err := s.store.LinkUser(ctx, userID, tenantID); err != nil {
		return nil, err
	}
	if err := s.store.CreateToken(ctx, userID); err != nil {
		return nil, err
	}
	event := map[string]string{
		"type":      "iam/events/register/v1.Event",
		"tenant_id": tenantID,
		"user_id":   userID,
	}
	if err := s.producer.Produce(ctx, event); err != nil {
		return nil, err
	}
	return &RegisterResult{TenantID: tenantID, UserID: userID}, nil
}
