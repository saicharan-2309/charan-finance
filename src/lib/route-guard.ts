/**
 * Pure routing decision for the root navigator — which route group a user may
 * see. Kept separate so the guard logic is unit-tested.
 */
export type RouteGroup = 'setup-required' | '(auth)' | '(app)' | 'reset-password';

export interface GuardInput {
  isConfigured: boolean;
  hasSession: boolean;
  /** Arrived via a password-recovery link (must set a new password first). */
  recovering: boolean;
}

export function allowedGroups({ isConfigured, hasSession, recovering }: GuardInput): Set<RouteGroup> {
  const allowed = new Set<RouteGroup>(['reset-password']);
  if (!isConfigured) {
    allowed.add('setup-required');
    return allowed;
  }
  if (!hasSession) allowed.add('(auth)');
  else if (!recovering) allowed.add('(app)');
  return allowed;
}
