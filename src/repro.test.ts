import {
  SqliteDriver,
  defineEntity,
  MikroORM,
  p,
  wrap,
} from "@mikro-orm/sqlite";

const EmergencyContactSchema = defineEntity({
  name: "EmergencyContact",
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    phone: p.string(),
  },
});

class EmergencyContact extends EmergencyContactSchema.class {}
EmergencyContactSchema.setClass(EmergencyContact);

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

const EmployeeSchema = defineEntity({
  name: "Employee",
  properties: {
    id: p.integer().primary(),
    name: p.string().hidden(), // Marked as hidden
    department: p.string(),
    emergencyContact: () => p.oneToOne(EmergencyContact),
    address: () => p.oneToOne(Address).hidden(), // Marked as hidden
  },
});

class Employee extends EmployeeSchema.class {}
EmployeeSchema.setClass(Employee);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [EmergencyContact, Address, Employee],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
  });
});

beforeEach(async () => {
  await orm.schema.refresh();
});

test("serialization populate option should not output hidden properties", async () => {
  let forkedEm = orm.em.fork();

  const emergencyContact = forkedEm.create(EmergencyContact, {
    name: "Janette Doe",
    phone: "0123456789",
  });
  const address = forkedEm.create(Address, {
    street: "1 Main Road",
    city: "Springfield",
  });
  const employee = forkedEm.create(Employee, {
    name: "John Doe",
    department: "Engineering",
    emergencyContact,
    address,
  });

  await forkedEm.flush();

  forkedEm = orm.em.fork();

  const foundEmployee = await forkedEm.findOneOrFail(
    Employee,
    { id: employee.id },
    { populate: ["*"] },
  );

  const serializedEmployee = wrap(foundEmployee).serialize({
    forceObject: true,
    exclude: undefined,
    // Generically serializing all populated relationships
    populate: ["*"],
  });

  console.log(serializedEmployee);

  expect(serializedEmployee).toEqual(
    expect.objectContaining({
      emergencyContact: {
        id: 1,
        name: "Janette Doe",
        phone: "0123456789",
      },
    }),
  );

  // Should not serialize hidden fields
  expect(serializedEmployee).not.toHaveProperty("address");
  expect(serializedEmployee).not.toHaveProperty("name");
});
