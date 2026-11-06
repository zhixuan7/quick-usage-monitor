import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryCsv } from "../frontend/src/lib/directory-csv";

test("directory CSV preserves Unicode, quoted multiline fields and nested account details", () => {
  const accounts = [
    { arn: "arn:quick:user/one", role: "ADMIN_PRO", active: true },
    { arn: "arn:quick:user/two", role: "READER", active: false },
  ];
  const csv = directoryCsv([
    {
      id: "user-id",
      username: "username",
      name: '王, "Example"\nPerson',
      email: "user@example.com",
      groups: [
        { id: "g1", name: "Admins" },
        { id: "g2", name: "Authors" },
      ],
      quickAccounts: accounts,
      quickRoles: "ADMIN_PRO, READER",
      lastActivity: "No recorded chats",
      messages: 0,
      observedAt: "2026-11-06T00:00:00Z",
      extraAttribute: "preserved",
    },
  ]);
  assert.equal(
    csv,
    '\uFEFF"User","Email","Groups","Quick roles","Latest chat activity","Messages in period","User ID","Username","Group IDs","Quick accounts (JSON)","Last observed","extraAttribute"\r\n' +
      '"王, ""Example""\nPerson","user@example.com","Admins; Authors","ADMIN_PRO, READER","No recorded chats","0","user-id","username","g1; g2","' +
      JSON.stringify(accounts).replace(/"/g, '""') +
      '","2026-11-06T00:00:00Z","preserved"\r\n',
  );
});

test("directory CSV exports every supplied user once, including users without groups or Quick accounts", () => {
  const users = Array.from({ length: 31 }, (_, i) => ({
    id: `user-${i}`,
    name: `Person ${i}`,
    email: null,
    groups: [],
    quickAccounts: [],
    messages: 0,
  }));
  const lines = directoryCsv(users).trimEnd().split("\r\n");
  assert.equal(lines.length, users.length + 1);
  for (const user of users)
    assert.equal(
      lines.filter((line) => line.includes(`"${user.id}"`)).length,
      1,
    );
  assert.ok(lines[1].startsWith('"Person 0","",""'));
  assert.ok(lines[1].includes('"[]"'));
  assert.ok(directoryCsv([]).startsWith('\uFEFF"User","Email","Groups"'));
});

test("directory CSV treats formula-like directory attributes as text", () => {
  for (const name of [
    '=HYPERLINK("https://example.com")',
    "+SUM(1,2)",
    "-1+2",
    "@SUM(1,2)",
    "  =1+1",
    "\t=1+1",
    "\rformula",
    "\nformula",
  ]) {
    const csv = directoryCsv([{ name }]);
    assert.ok(csv.includes(`"'${name.replace(/"/g, '""')}"`));
  }
});
