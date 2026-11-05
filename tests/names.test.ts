import { test } from "node:test";
import assert from "node:assert/strict";
import { nameLookup } from "../infra/lambda/api/names";
const users = [
  {
    id: "idc-user",
    name: "Example Person",
    email: "person@example.com",
    username: "person",
  },
];
const quick = [
  {
    arn: "arn:aws:quicksight:ap-southeast-2:123456789012:user/default/person",
    name: "person",
    email: "person@example.com",
    identityId: "idc-user",
  },
];
test("agent creator internal Identity Center ARN resolves to name and email", () => {
  const names = nameLookup(users, quick, []);
  const result = names.person(
    "arn:aws:quicksight::123456789012:user-internal/idc/instance/application/IDENTITY_STORE_ID/idc-user",
  );
  assert.equal(result?.display, "Example Person (person@example.com)");
  assert.equal(names.person(quick[0].arn)?.email, "person@example.com");
});
test("unknown or ambiguous identities are not assigned an unrelated name", () => {
  const names = nameLookup(
    [
      ...users,
      { id: "another", name: "Other Person", email: "person@example.com" },
    ],
    [],
    [],
  );
  assert.equal(names.person("person@example.com"), undefined);
  assert.equal(names.person("unknown"), undefined);
});
test("connector names are scoped by region and retain deleted inventory names for audit history", () => {
  const names = nameLookup(
    [],
    [],
    [
      {
        id: "connector",
        region: "ap-southeast-2",
        name: "Sydney CRM",
        deletedAt: "yesterday",
      },
      { id: "connector", region: "us-east-1", name: "US CRM" },
    ],
  );
  assert.equal(names.connector("connector", "ap-southeast-2"), "Sydney CRM");
  assert.equal(names.connector("connector", "us-east-1"), "US CRM");
  assert.equal(names.connector("unknown", "ap-southeast-2"), "unknown");
  assert.equal(names.connector("connector", "eu-west-1"), "connector");
});
