import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const AddressSchema = defineEntity({
  name: "Address",
  properties: {
    id: p.integer().primary(),
    street: p.string(),
    city: p.string(),
  },
});

class Address extends AddressSchema.class {}
AddressSchema.setClass(Address);

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
    address: () => p.oneToOne(Address),
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
    entities: [Address, Person, Employee],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
});

afterAll(async () => {
  await orm.close(true);
});

beforeEach(async () => {
  await orm.schema.refresh();

  const forkedEm = orm.em.fork();

  const address = forkedEm.create(Address, {
    street: "1 Main Road",
    city: "Springfield",
  });
  const employee = forkedEm.create(Employee, {
    name: "John Doe",
    department: "Engineering",
    address,
  });

  await forkedEm.flush();
  employeeId = employee.id;
});

test("relationship of tpt child entities are populated when targeting child type", async () => {
  const forkedEm = orm.em.fork();

  /**
   * Two queries:

      SELECT
        `e0`.*,
        `p1`.`id` AS `p1__id`,
        `p1`.`name` AS `p1__name`
      FROM
        `employee` AS `e0`
        INNER JOIN `person` AS `p1` ON `e0`.`id` = `p1`.`id`
      WHERE
        `p1`.`id` = 1
      LIMIT
        1


      SELECT
        `a0`.*
      FROM
        `address` AS `a0`
      WHERE
        `a0`.`id` IN (1)
   */
  const foundEmployee = await forkedEm.findOne(
    Employee,
    { id: employeeId },
    { populate: ["*"] },
  );

  console.log(foundEmployee);

  expect(foundEmployee).not.toBeFalsy();

  expect(foundEmployee?.address).toEqual(
    expect.objectContaining({ city: "Springfield" }),
  );
});

test("relationship of tpt child entities are NOT populated when targeting abstract parent type", async () => {
  const forkedEm = orm.em.fork();

  /**
   * A single query:

      SELECT
        `p0`.*,
        `e1`.`department` AS `e1__department`,
        `e1`.`address_id` AS `e1__address_id`,
        CASE
            WHEN `e1`.`id` IS NOT NULL THEN 'employee'
            ELSE NULL END
          AS `p0____tpt_type`
      FROM
        `person` AS `p0`
        LEFT JOIN `employee` AS `e1` ON `p0`.`id` = `e1`.`id`
      WHERE
        `p0`.`id` = 1
      LIMIT
        1
   */
  const foundPerson = await forkedEm.findOne(
    Person,
    { id: employeeId },
    // Note: Using the option is necessary for the leaf entity Employee constructor to be used
    { populate: ["*"] },
  );

  console.log(foundPerson);

  expect(foundPerson).not.toBeFalsy();
  expect(foundPerson).toBeInstanceOf(Employee);

  // Just a type guard for TypeScript
  if (!(foundPerson instanceof Employee)) {
    throw new Error();
  }
  console.log(foundPerson.constructor.name);

  expect(foundPerson?.address).toEqual(
    expect.objectContaining({ city: "Springfield" }),
  );
});
