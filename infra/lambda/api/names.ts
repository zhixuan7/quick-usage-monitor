type RecordData = Record<string, any>;
type Person = { key: string; name: string; email: string };
const normalize = (value: string) => value.trim().toLowerCase();

/** A duplicate alias is left unresolved rather than attributed to the wrong person. */
export function nameLookup(
  users: RecordData[],
  quickUsers: RecordData[],
  connectors: RecordData[],
) {
  const people = new Map<string, Person | null>();
  const directory = new Map<string, Person>();
  function alias(key: unknown, person: Person) {
    if (typeof key !== "string" || !key.trim()) return;
    const id = normalize(key);
    const prior = people.get(id);
    people.set(
      id,
      prior === undefined || prior?.key === person.key ? person : null,
    );
  }
  for (const user of users) {
    const person = {
      key: user.id,
      name: user.name ?? "",
      email: user.email ?? "",
    };
    directory.set(user.id, person);
    for (const key of [user.id, user.username, user.email]) alias(key, person);
  }
  for (const user of quickUsers) {
    const person = directory.get(user.identityId) ??
      (typeof user.email === "string"
        ? people.get(normalize(user.email))
        : undefined) ?? {
        key: user.arn ?? user.id,
        name: user.name ?? "",
        email: user.email ?? "",
      };
    for (const key of [user.arn, user.id, user.name, user.email])
      alias(key, person);
  }
  const connectorAliases = new Map<string, string | null>();
  for (const connector of connectors) {
    if (!connector.name) continue;
    for (const id of [connector.id, connector.arn])
      if (id) {
        const key = `${connector.region}#${id}`;
        const prior = connectorAliases.get(key);
        connectorAliases.set(
          key,
          prior === undefined || prior === connector.name
            ? connector.name
            : null,
        );
      }
  }
  return {
    person(identifier: unknown) {
      if (typeof identifier !== "string" || !identifier) return undefined;
      let person = people.get(normalize(identifier));
      // DescribeAgent returns this internal IDC ARN rather than a Quick user ARN.
      const internal = identifier.match(
        /:user-internal\/idc\/[^/]+\/[^/]+\/IDENTITY_STORE_ID\/([^/]+)$/,
      );
      if (person === undefined && internal)
        person = people.get(normalize(internal[1]));
      if (!person) return undefined;
      return {
        ...person,
        display:
          person.name &&
          person.email &&
          normalize(person.name) !== normalize(person.email)
            ? `${person.name} (${person.email})`
            : person.email || person.name,
      };
    },
    connector(identifier: string | undefined, region: string) {
      return identifier
        ? connectorAliases.get(`${region}#${identifier}`) || identifier
        : undefined;
    },
  };
}
