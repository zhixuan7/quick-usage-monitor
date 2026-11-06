export const directoryColumns: [string, string][] = [
  ["name", "User"],
  ["email", "Email"],
  ["groups", "Groups"],
  ["quickRoles", "Quick roles"],
  ["lastActivity", "Latest chat activity"],
  ["messages", "Messages in period"],
];

function csvCell(value: unknown): string {
  let text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Directory attributes are untrusted text; keep spreadsheet apps from
  // treating user-supplied names or usernames as formulas.
  if (
    typeof value === "string" &&
    (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))
  )
    text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One row per directory user, including all memberships and account details. */
export function directoryCsv(users: Record<string, any>[]): string {
  const rows: Record<string, unknown>[] = users.map((user) => ({
    ...user,
    groups: (user.groups ?? []).map((group: any) => group.name).join("; "),
    groupIds: (user.groups ?? []).map((group: any) => group.id).join("; "),
  }));
  const columns: [string, string][] = [
    ...directoryColumns,
    ["id", "User ID"],
    ["username", "Username"],
    ["groupIds", "Group IDs"],
    ["quickAccounts", "Quick accounts (JSON)"],
    ["observedAt", "Last observed"],
  ];
  const known = new Set(columns.map(([key]) => key));
  // Preserve any additional attributes supplied by the directory API.
  const additional = [...new Set(rows.flatMap(Object.keys))]
    .filter((key) => !known.has(key))
    .sort();
  columns.push(...additional.map((key): [string, string] => [key, key]));
  return (
    "\uFEFF" +
    [
      columns.map(([, label]) => csvCell(label)).join(","),
      ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
