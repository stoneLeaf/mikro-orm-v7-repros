import {
  SqliteDriver,
  defineEntity,
  MikroORM,
  p,
  EventSubscriber,
  FlushEventArgs,
  wrap,
} from "@mikro-orm/sqlite";

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

export class FlushSubscriber implements EventSubscriber {
  onFlush({ uow }: FlushEventArgs): void {
    const changeSets = uow.getChangeSets();

    for (const changeSet of changeSets) {
      changeSet.entity.department = "HR";

      // Original leaf payload:
      //   department: 'Engineering',
      //   id: EntityIdentifier { value: undefined },
      console.log(changeSet.payload);

      uow.recomputeSingleChangeSet(changeSet.entity);

      // Leaf payload gets the TPT parent field 'name' after recomputation:
      //   department: 'HR',
      //   id: EntityIdentifier { value: undefined },
      //   name: 'John Doe'
      console.log(changeSet.payload);
    }
  }
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [Person, Employee],
    debug: ["query", "query-params"],
    allowGlobalContext: true,
    subscribers: [FlushSubscriber],
  });
  await orm.schema.refresh();
});

afterAll(async () => {
  await orm.close(true);
});

test.only("recomputing changeset of leaf TPT entity fails", async () => {
  const employee = orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
  });

  /**
   * The recomputed changeset results in this query:
   *   insert into `employee` (`department`, `id`, `name`) values ('HR', 1, 'John Doe')
   * Which fails because 'name' is a field of the parent TPT entity Person
   */
  await orm.em.flush();

  expect(wrap(employee).isInitialized()).toBe(true);
});
