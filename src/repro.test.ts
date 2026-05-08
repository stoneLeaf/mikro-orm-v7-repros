import {
  SqliteDriver,
  defineEntity,
  MikroORM,
  p,
  wrap,
} from "@mikro-orm/sqlite";

const SOFT_DELETE_FILTER = {
  excludeDeleted: {
    name: "excludeDeleted",
    cond: { deletedAt: null },
    default: true,
  },
};

/**
 * Abstract TPT base entity with a soft-delete filter.
 */
const PersonSchema = defineEntity({
  name: "Person",
  tableName: "person",
  abstract: true,
  inheritance: "tpt",
  filters: { ...SOFT_DELETE_FILTER },
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    deletedAt: p.datetime().nullable(),
  },
});

class Person extends PersonSchema.class {}
PersonSchema.setClass(Person);

const BadgeSchema = defineEntity({
  name: "Badge",
  tableName: "badge",
  properties: {
    id: p.integer().primary(),
    code: p.string(),
    parentEmployee: () =>
      p.oneToOne(Employee).mappedBy("badge").ref().nullable(),
    parentContractor: () =>
      p.oneToOne(Contractor).mappedBy("temporaryBadge").ref().nullable(),
  },
});

class Badge extends BadgeSchema.class {}
BadgeSchema.setClass(Badge);

/**
 * Concrete subtype 1 — has an eager owner-side OneToOne to Badge.
 */
const EmployeeSchema = defineEntity({
  name: "Employee",
  tableName: "person_employee",
  extends: Person,
  properties: {
    id: p.integer().primary(),
    badge: () => p.oneToOne(Badge).owner().eager(),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

/**
 * Concrete subtype 2 — also has an eager owner-side OneToOne to Badge.
 * Required to replicate the multi-subtype structure that triggers the bug:
 * Badge holds inverse OneToOne references back to *both* subtypes.
 */
const ContractorSchema = defineEntity({
  name: "Contractor",
  tableName: "person_contractor",
  extends: Person,
  properties: {
    id: p.integer().primary(),
    temporaryBadge: () => p.oneToOne(Badge).owner().eager(),
  },
});

class Contractor extends ContractorSchema.class {}
ContractorSchema.setClass(Contractor);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Person, Badge, Employee, Contractor],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
});

beforeEach(async () => {
  await orm.schema.refresh();
});

afterAll(async () => {
  await orm.close();
});

test("eager OneToOne relation is populated when the filter is disabled", async () => {
  let em = orm.em.fork();

  const badge = em.create(Badge, { code: "BADGE-001" });
  const employee = em.create(Employee, { name: "John Doe", badge });
  await em.flush();

  em = orm.em.fork();

  const found = await em.findOneOrFail(
    Employee,
    { id: employee.id },
    { populate: ["*"], filters: false },
  );

  expect(wrap(found.badge).isInitialized()).toBe(true);
  expect(found.badge.code).toBe("BADGE-001");
});

test("eager OneToOne relation should be populated when a filter is applied to the base TPT entity", async () => {
  let em = orm.em.fork();

  const badge = em.create(Badge, { code: "BADGE-001" });
  const employee = em.create(Employee, { name: "John Doe", badge });
  await em.flush();

  em = orm.em.fork();

  const found = await em.findOneOrFail(
    Employee,
    { id: employee.id },
    { populate: ["*"] },
  );

  console.log(found);

  // `badge` is declared eager on EmployeeSchema, so it must always be populated.
  // When SOFT_DELETE_FILTER is applied to Person (the abstract TPT base), loading Badge
  // produces duplicate JOINs in the generated SQL: one filtered set (with
  // `deleted_at IS NULL` on the JOIN condition) and one unfiltered duplicate set.
  // Those unfiltered duplicate JOINs trigger additional hydration queries that reset
  // the `badge` reference on Employee back to an uninitialised proxy.
  expect(wrap(found.badge).isInitialized()).toBe(true);
  expect(found.badge.code).toBe("BADGE-001");
});
