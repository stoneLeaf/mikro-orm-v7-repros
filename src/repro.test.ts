import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const PersonSchema = defineEntity({
  name: "Person",
  abstract: true,
  inheritance: "tpt",
  properties: {
    id: p.integer().primary(),
    name: p.string(),
  },
});

class Person extends PersonSchema.class {}
PersonSchema.setClass(Person);

const EmployeeSchema = defineEntity({
  name: "Employee",
  extends: Person,
  // TPT leaf index
  indexes: [{ properties: ["department"] }],
  properties: {
    // Leaf property to be indexed
    department: p.string(),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

let orm: MikroORM;
let employeeId: number;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Person, Employee],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
});

beforeEach(async () => {
  await orm.schema.refresh();

  const forkedEm = orm.em.fork();

  const employee = forkedEm.create(Employee, {
    name: "John Doe",
    department: "Engineering",
  });

  await forkedEm.flush();
  employeeId = employee.id;
});

/**
 * MetadataError: Entity Employee has wrong index definition: 'department' does not exist. You need to use property name, not column name.
 */
test("should allow indexes (and unique indexes) on tpt leaf properties", async () => {
  let forkedEm = orm.em.fork();

  const foundEmployee = await forkedEm.findOne(Person, { id: employeeId });

  expect(foundEmployee).toBeTruthy();
});
