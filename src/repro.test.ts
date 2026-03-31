import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";
import { jest } from "@jest/globals";

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
  properties: {
    department: p.string(),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Person, Employee],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
  await orm.schema.refresh();
});

afterAll(async () => {
  await orm.close(true);
});

test.only("sequential flush of unchanged TPT entity triggers update", async () => {
  orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
  });

  const logQuerySpy = jest.spyOn(orm.config.getLogger(), "logQuery");

  // First flush
  await orm.em.flush();

  expect(logQuerySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      query:
        "insert into `person` (`name`) values (\'John Doe\') returning `id`",
    }),
  );
  expect(logQuerySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      query:
        "insert into `employee` (`department`, `id`) values (\'Engineering\', 1)",
    }),
  );

  logQuerySpy.mockClear();

  // Sequential flush
  await orm.em.flush();

  /**
   * Query executed on second consecutive flush:
   *  update `person` set `name` = 'John Doe' where `id` = 1
   */
  expect(logQuerySpy).not.toHaveBeenCalled();
});
