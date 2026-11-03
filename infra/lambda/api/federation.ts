import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

type Claims = Record<string, unknown>;

/**
 * Only use behind the HTTP API's JWT authorizer. API Gateway validates the
 * Authorization token's signature, issuer, audience and lifetime first.
 * Nested claims may be stringified by the integration, so recover them from
 * that same token and bind its scalar claims to the trusted authorizer context.
 * This decoder is not a replacement for signature verification.
 */
export function federatedClaims(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Claims | null {
  const verified = event.requestContext.authorizer?.jwt?.claims;
  if (!verified?.sub || !verified.iss || !verified.aud) return null;
  const authorization =
    event.headers?.authorization ?? event.headers?.Authorization;
  const token = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[2]) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return null;
    if (
      payload.sub !== verified.sub ||
      payload.iss !== verified.iss ||
      payload.aud !== verified.aud ||
      payload.token_use !== "id"
    )
      return null;
    if (
      !Array.isArray(payload.identities) ||
      !payload.identities.some(
        (id: any) =>
          id?.providerName === "IdentityCenter" && id.providerType === "SAML",
      )
    )
      return null;
    if (typeof payload.email !== "string" || !payload.email.trim()) return null;
    return payload;
  } catch {
    return null;
  }
}
