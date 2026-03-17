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

const AddressEmbeddableSchema = defineEntity({
  name: "AddressEmbeddable",
  embeddable: true,
  properties: {
    street: p.string().nullable(),
  },
});

class AddressEmbeddable extends AddressEmbeddableSchema.class {}
AddressEmbeddableSchema.setClass(AddressEmbeddable);

const EmployeeSchema = defineEntity({
  name: "Employee",
  extends: Person,
  properties: {
    department: p.string(),
    address: p
      .embedded(AddressEmbeddable)
      .onCreate(() => new AddressEmbeddable()),
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

const ManagerSchema = defineEntity({
  name: "Manager",
  extends: Employee,
  properties: {
    teamSize: p.integer(),
  },
});

class Manager extends ManagerSchema.class {}
ManagerSchema.setClass(Manager);

const RoomSchema = defineEntity({
  name: "Room",
  properties: {
    id: p.integer().primary(),
    assignedTo: () => p.manyToOne(Person).ref(),
  },
});

class Room extends RoomSchema.class {}
RoomSchema.setClass(Room);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Person, Employee, Manager, Room],
    debug: ["query", "query-params"],
    allowGlobalContext: true, // only for testing
  });
  await orm.schema.refresh();
});

afterAll(async () => {
  await orm.close(true);
});

test("FAILS when an entity in the TPT tree has an embeddable", async () => {
  const employee = orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
  });
  const room = orm.em.create(Room, {
    assignedTo: employee,
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  /**
    InvalidFieldNameException: no such column: e3.address
   
    select `r0`.*,
      `m2`.`team_size` as `m2__team_size`,
      `e3`.`department` as `e3__department`,
      `e3`.`address` as `e3__address`,                  <--- ISSUE HERE
      `e3`.`address_street` as `e3__address_street`,
      case
        when `m2`.`id` is not null then 'manager'
        when `e3`.`id` is not null then 'employee'
        else null end as `a1____tpt_type`,
      `a1`.`id` as `a1__id`,
      `a1`.`name` as `a1__name`
    from `room` as `r0`
    inner join `person` as `a1` on `r0`.`assigned_to_id` = `a1`.`id`
    left join `manager` as `m2` on `a1`.`id` = `m2`.`id`
    left join `employee` as `e3` on `a1`.`id` = `e3`.`id`
    where `r0`.`id` = 1
    limit 1
  */
  const foundRoom = await forkedEm.findOne(
    Room,
    { id: room.id },
    { populate: ["assignedTo"] },
  );

  expect(foundRoom).not.toBeFalsy();

  console.log(foundRoom);
});

test("FAILS with another TPT entity from the same tree which has NO embeddable", async () => {
  const manager = orm.em.create(Manager, {
    name: "John Doe",
    department: "Sales",
    teamSize: 10,
  });
  const room = orm.em.create(Room, {
    assignedTo: manager,
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  const foundRoom = await forkedEm.findOne(
    Room,
    { id: room.id },
    { populate: ["assignedTo"] },
  );

  expect(foundRoom).not.toBeFalsy();

  console.log(foundRoom);
});
