import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const OfficeSpaceSchema = defineEntity({
  name: "OfficeSpace",
  properties: {
    id: p.integer().primary(),
    level: p.integer(),
    door: p.integer(),
    // Reverse side
    permanentOccupant: () =>
      p.oneToOne(Employee).mappedBy("officeSpace").nullable(),
  },
});

class OfficeSpace extends OfficeSpaceSchema.class {}
OfficeSpaceSchema.setClass(OfficeSpace);

const TempOfficeSpaceSchema = defineEntity({
  name: "TempOfficeSpace",
  properties: {
    id: p.integer().primary(),
    level: p.integer(),
    door: p.integer(),
    // No reverse side declared to Contractor
  },
});

class TempOfficeSpace extends TempOfficeSpaceSchema.class {}
TempOfficeSpaceSchema.setClass(TempOfficeSpace);

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
    // Owning side
    officeSpace: () => p.oneToOne(OfficeSpace),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

const ContractorSchema = defineEntity({
  name: "Contractor",
  extends: Person,
  properties: {
    department: p.string(),
    // Owning side, without a declared reverse side
    tempOfficeSpace: () => p.oneToOne(TempOfficeSpace),
  },
});

class Contractor extends ContractorSchema.class {}
ContractorSchema.setClass(Contractor);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [OfficeSpace, TempOfficeSpace, Person, Employee, Contractor],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
});

afterAll(async () => {
  await orm.close(true);
});

beforeEach(async () => {
  await orm.schema.refresh();
});

test("owning side of 1:1 tpt leaf relationship fails to populate if reverse declared", async () => {
  const officeSpace = orm.em.create(OfficeSpace, {
    level: 12,
    door: 126,
  });
  const employee = orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
    officeSpace,
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  /**
    Query fails as it tries to select parent TPT Person column 'name' in the leaf Employee table:

      SELECT
        `o0`.*,
        `o1`.`id` AS `o1__id`,
        `o1`.`name` AS `o1__name`,
        `o1`.`department` AS `o1__department`,
        `o1`.`office_space_id` AS `o1__office_space_id`
      FROM
        `office_space` AS `o0`
        LEFT JOIN `employee` AS `o1` ON `o0`.`id` = `o1`.`office_space_id`
      WHERE
        `o0`.`id` IN (1)
   */
  const foundEmployee = await forkedEm.findOne(
    Employee,
    { id: employee.id },
    { populate: ["*"] },
  );

  expect(foundEmployee).not.toBeFalsy();
});

test("reverse side of 1:1 tpt leaf relationship fails to populate", async () => {
  const officeSpace = orm.em.create(OfficeSpace, {
    level: 12,
    door: 126,
  });
  orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
    officeSpace,
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  /**
    Query fails as it tries to select parent TPT Person column 'name' in the leaf Employee table:

      SELECT
        `o0`.*,
        `o1`.`id` AS `o1__id`,
        `o1`.`name` AS `o1__name`,
        `o1`.`department` AS `o1__department`,
        `o1`.`office_space_id` AS `o1__office_space_id`
      FROM
        `office_space` AS `o0`
        LEFT JOIN `employee` AS `o1` ON `o0`.`id` = `o1`.`office_space_id`
      WHERE
        `o0`.`id` = 1
      LIMIT
        1
   */
  const foundOfficeSpace = await forkedEm.findOne(
    OfficeSpace,
    { id: officeSpace.id },
    { populate: ["*"] },
  );

  expect(foundOfficeSpace).not.toBeFalsy();
});

test("owning side of 1:1 tpt leaf relationship populates successfully if reverse side not declared", async () => {
  const tempOfficeSpace = orm.em.create(TempOfficeSpace, {
    level: 2,
    door: 21,
  });
  const contractor = orm.em.create(Contractor, {
    name: "Francis Bacon",
    department: "Legal",
    tempOfficeSpace,
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  /**
    2 successful queries:

    > SELECT
        `c0`.*,
        `p1`.`id` AS `p1__id`,
        `p1`.`name` AS `p1__name`
      FROM
        `contractor` AS `c0`
        INNER JOIN `person` AS `p1` ON `c0`.`id` = `p1`.`id`
      WHERE
        `p1`.`id` = 1
      LIMIT
        1

    > SELECT
        `t0`.*
      FROM
        `temp_office_space` AS `t0`
      WHERE
        `t0`.`id` IN (1)
   */
  const foundContractor = await forkedEm.findOne(
    Contractor,
    { id: contractor.id },
    { populate: ["*"] },
  );

  expect(foundContractor).not.toBeFalsy();
  expect(foundContractor?.tempOfficeSpace).toEqual(
    expect.objectContaining({ level: 2 }),
  );
});
