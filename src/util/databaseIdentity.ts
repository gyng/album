// Query keys need identity, not serialised SQLite internals or a ready boolean.
// Weak keys do not keep retired database instances alive.
const identities = new WeakMap<object, number>();
let nextIdentity = 0;

export const databaseIdentity = (database: object | null): number | null => {
  if (!database) return null;
  const known = identities.get(database);
  if (known !== undefined) return known;
  const identity = ++nextIdentity;
  identities.set(database, identity);
  return identity;
};
