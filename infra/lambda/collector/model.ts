import { createHash } from "node:crypto";
export function fingerprint(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function changedFields(before: any, after: any) {
  return [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ].filter(
    (k) => fingerprint(before?.[k] ?? null) !== fingerprint(after?.[k] ?? null),
  );
}
export function matchIdentity(quick: any, users: any[]) {
  const direct = users.filter(
    (u) => u.id === quick.ExternalLoginId || u.id === quick.PrincipalId,
  );
  if (direct.length === 1)
    return { identityId: direct[0].id, matchMethod: "stable-id" };
  const candidates = users.filter(
    (u) => u.email && u.email.toLowerCase() === quick.Email?.toLowerCase(),
  );
  return candidates.length === 1
    ? { identityId: candidates[0].id, matchMethod: "unique-email" }
    : { identityId: "", matchMethod: "unresolved" };
}
export function safeConnector(a: any, region: string) {
  return {
    id: a.ActionConnectorId,
    name: a.Name,
    arn: a.Arn,
    region,
    type: a.Type,
    status: a.Status,
    authenticationType: a.AuthenticationConfig?.AuthenticationType,
    enabledActions: a.EnabledActions ?? [],
    vpcConnectionArn: a.VpcConnectionArn,
    createdAt: a.CreatedTime?.toISOString(),
    updatedAt: a.LastUpdatedTime?.toISOString(),
  };
}
