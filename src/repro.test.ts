import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const ReportSchema = defineEntity({
  name: "Report",
  properties: {
    id: p.integer().primary(),
    author: () => p.manyToOne(Person).ref(),
    content: p.blob(),
  },
});

class Report extends ReportSchema.class {}
ReportSchema.setClass(Report);

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
    address: () => p.oneToOne(Address).owner().eager(),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

let orm: MikroORM;
let reportId: number;
let employeeId: number;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Report, Address, Person, Employee],
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
  const report = forkedEm.create(Report, {
    author: employee,
    content: Buffer.from("Lorem Ipsum"),
  });

  await forkedEm.flush();
  reportId = report.id;
  employeeId = employee.id;
});

test("related TPT leaf own relationship populated", async () => {
  const forkedEm = orm.em.fork();

  const report = await forkedEm.findOne(
    Report,
    { id: reportId },
    { populate: ["*"] },
  );

  console.log(JSON.stringify(report, null, 2));

  expect(report).not.toBeFalsy();

  const author = report?.author.getEntity();
  expect(author).toBeInstanceOf(Employee);

  // Just a type guard for TypeScript
  if (!(author instanceof Employee)) {
    throw new Error();
  }

  expect(author.address).toEqual(
    expect.objectContaining({ city: "Springfield" }),
  );
});

test("related TPT leaf own relationship NOT populated if leaf loaded prior without populate in same context", async () => {
  const forkedEm = orm.em.fork();

  // Loading TPT leaf in current identity map
  const person = await forkedEm.findOne(Person, { id: employeeId });
  expect(person).not.toBeFalsy();

  // Then doing the exact same find at the test above
  const report = await forkedEm.findOne(
    Report,
    { id: reportId },
    { populate: ["*"] },
  );

  console.log(JSON.stringify(report, null, 2));

  expect(report).not.toBeFalsy();

  const author = report?.author.getEntity();
  expect(author).toBeInstanceOf(Employee);

  // Just a type guard for TypeScript
  if (!(author instanceof Employee)) {
    throw new Error();
  }

  expect(author.address).toEqual(
    expect.objectContaining({ city: "Springfield" }),
  );
});
