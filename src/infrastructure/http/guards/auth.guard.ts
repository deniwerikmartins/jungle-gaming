import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * AuthGuard — no-op stub.
 *
 * Per the challenge spec (Section 2), authentication is explicitly out of scope
 * for scoring purposes. This guard accepts all requests and serves as the
 * extension point for a real IdP integration (e.g., Keycloak / Zitadel OIDC).
 *
 * In production this would validate a JWT Bearer token against the IdP's
 * JWKS endpoint and attach the verified identity to the request context.
 *
 * See ARCHITECTURE.md for the full design of the auth extension point.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
