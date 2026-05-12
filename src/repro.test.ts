import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

/**
 * Mirrors a real-world helper that builds an expression-based unique index
 * using a partial WHERE clause on a soft-delete column. The expression
 * function receives a `columns` Record that maps entity property names to
 * database column names for the table currently being processed.
 */
function uniqueWhereNotDeleted(...properties: string[]) {
  return {
    expression: (columns: Record<string, string>, table: { name: string }) => {
      const cols = properties.map((prop) => columns[prop]);
      return `CREATE UNIQUE INDEX "${table.name}_${cols.join("_")}_not_deleted_unique" ON "${table.name}" (${cols.join(", ")}) WHERE deleted_at IS NULL`;
    },
  };
}

// Parent TPT entity. Its table holds 'name' and 'deleted_at'.
// The expression index correctly references the 'name' column.
const AnimalSchema = defineEntity({
  name: "Animal",
  abstract: true,
  inheritance: "tpt",
  indexes: [uniqueWhereNotDeleted("name")],
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    deletedAt: p.datetime().nullable(),
  },
});

class Animal extends AnimalSchema.class {}
AnimalSchema.setClass(Animal);

// Child TPT entity. Its own table only holds 'id' and 'breed' — NOT 'name'.
// The parent's expression index is propagated here, but 'name' is absent
// from the child table's column mapping, so columns['name'] is undefined.
const DogSchema = defineEntity({
  name: "Dog",
  extends: Animal,
  properties: {
    id: p.integer().primary(),
    breed: p.string(),
  },
});

class Dog extends DogSchema.class {}
DogSchema.setClass(Dog);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Animal, Dog],
    allowGlobalContext: true,
  });
});

afterAll(async () => {
  await orm.close(true);
});

test("parent table gets a valid expression index on its own column", async () => {
  const sql = await orm.schema.getCreateSchemaSQL();
  // Parent table: columns['name'] resolves correctly → valid SQL
  expect(sql).toContain('"animal" (name) WHERE deleted_at IS NULL');
});

test("child TPT table should NOT receive the parent expression index with an empty column list", async () => {
  const sql = await orm.schema.getCreateSchemaSQL();
  // BUG: columns['name'] is undefined for the child table, so cols.join(', ')
  // produces an empty string, yielding this invalid SQL fragment:
  //   CREATE UNIQUE INDEX "dog__not_deleted_unique" ON "dog" () WHERE deleted_at IS NULL
  expect(sql).not.toMatch(/CREATE UNIQUE INDEX "[^"]+" ON "dog" \(\) WHERE/);
});

test("schema creation should not fail due to empty-column index propagated to child TPT table", async () => {
  // BUG: throws because the invalid SQL above is executed against the database
  await expect(orm.schema.create()).resolves.not.toThrow();
});
