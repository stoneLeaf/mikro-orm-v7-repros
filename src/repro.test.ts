import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const AssetSchema = defineEntity({
  name: "Asset",
  properties: {
    id: p.integer().primary(),
    serial: p.string(),
    owner: () => p.manyToOne(Person),
  },
});

class Asset extends AssetSchema.class {}
AssetSchema.setClass(Asset);

const PersonSchema = defineEntity({
  name: "Person",
  abstract: true,
  inheritance: "tpt",
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    assets: () => p.oneToMany(Asset).mappedBy("owner"),
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
    entities: [Person, Employee, Asset],
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

test.only("query fails for TPT leaf having a TPT parent with 1:m relationship", async () => {
  orm.em.create(Employee, {
    name: "John Doe",
    department: "Engineering",
  });
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  /**
     DriverException: prop.fieldNames is not iterable
      at SqliteDriver.mapTPTColumns (node_modules/@mikro-orm/sql/AbstractSqlDriver.js:323:40)

     Relationship 'prop' value that cannot have 'fieldNames' iterated:
        {                                                                                                                                                           
          name: 'assets',
          kind: '1:m',
          cascade: [ 'persist' ],
          entity: [Function: entity],
          mappedBy: 'owner',
          type: 'Asset',
          target: [class Asset extends Asset],
          referencedPKs: [ 'id' ],
          targetMeta: [EntityMetadata<Asset>],
          runtimeType: 'unknown',
          unsigned: undefined,
          length: undefined,
          precision: undefined,
          scale: undefined,
          columnTypes: [ 'integer' ],
          customType: undefined,
          nullable: undefined,
          joinColumns: [ 'assets_id' ],
          referencedColumnNames: [ 'id' ]
        }
   */
  const foundEmployee = await forkedEm.findAll(Person);

  expect(foundEmployee).not.toBeFalsy();
});
