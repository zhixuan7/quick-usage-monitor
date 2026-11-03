import { test } from "node:test";
import assert from "node:assert/strict";
import { federatedClaims } from "../infra/lambda/api/federation";

const payload = {
  sub: "signed-subject",
  iss: "https://issuer.example.com",
  aud: "dashboard-client",
  token_use: "id",
  email: "admin@example.com",
  identities: [
    {
      providerName: "IdentityCenter",
      providerType: "SAML",
      userId: "stable-id",
    },
  ],
};
// Synthetic token is used only with a synthetic already-verified integration
// context; external API Gateway independently rejects unsigned/forged tokens.
function event(overrides: Record<string, unknown> = {}) {
  const p = { ...payload, ...overrides };
  return {
    headers: {
      authorization: `Bearer ${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(p)).toString("base64url")}.test-signature`,
    },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: payload.sub,
            iss: payload.iss,
            aud: payload.aud,
            identities: "[map[providerName:IdentityCenter providerType:SAML]]",
          },
        },
      },
    },
  } as any;
}
test("federation survives non-JSON nested claims in the gateway context", () => {
  assert.equal(federatedClaims(event())?.email, "admin@example.com");
});
test("requires a verified context and the same issuer, subject and audience", () => {
  const e = event();
  delete e.requestContext.authorizer;
  assert.equal(federatedClaims(e), null);
  for (const key of ["iss", "sub", "aud"])
    assert.equal(federatedClaims(event({ [key]: "different" })), null);
});
test("denies local, wrong-provider and access-token identities", () => {
  assert.equal(federatedClaims(event({ identities: undefined })), null);
  assert.equal(
    federatedClaims(
      event({
        identities: [{ providerName: "OtherProvider", providerType: "SAML" }],
      }),
    ),
    null,
  );
  assert.equal(
    federatedClaims(
      event({
        identities: [{ providerName: "IdentityCenter", providerType: "OIDC" }],
      }),
    ),
    null,
  );
  assert.equal(federatedClaims(event({ token_use: "access" })), null);
  assert.equal(federatedClaims(event({ email: "" })), null);
});
test("rejects missing or malformed bearer headers", () => {
  for (const authorization of [
    undefined,
    "Basic value",
    "Bearer bad",
    "Bearer a.bad.signature",
  ]) {
    const e = event();
    e.headers.authorization = authorization;
    assert.equal(federatedClaims(e), null);
  }
});
