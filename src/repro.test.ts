import { defineEntity, MikroORM, p } from "@mikro-orm/sqlite";

const EntityAWithFilterSchema = defineEntity({
  name: "EntityAWithFilter",
  filters: {
    excludeSoftDeleted: {
      name: "excludeSoftDeleted",
      cond: { deletedAt: null },
      default: true,
    },
  },
  properties: {
    id: p.integer().primary(),
    deletedAt: p.datetime().nullable(),
  },
});

export class EntityAWithFilter extends EntityAWithFilterSchema.class {}
EntityAWithFilterSchema.setClass(EntityAWithFilter);

const EntityBSchema = defineEntity({
  name: "EntityB",
  properties: {
    id: p.integer().primary(),
  },
});

export class EntityB extends EntityBSchema.class {}
EntityBSchema.setClass(EntityB);

const EntityCSchema = defineEntity({
  name: "EntityC",
  properties: {
    id: p.integer().primary(),
  },
});

export class EntityC extends EntityCSchema.class {}
EntityCSchema.setClass(EntityC);

const Owner1Schema = defineEntity({
  name: "Owner1",
  properties: {
    id: p.integer().primary(),
    poly: () => p.manyToOne([EntityAWithFilter, EntityB]),
    otherProperty: p.string().nullable(),
  },
});

export class Owner1 extends Owner1Schema.class {}
Owner1Schema.setClass(Owner1);

const Owner2Schema = defineEntity({
  name: "Owner2",
  properties: {
    id: p.integer().primary(),
    poly: () => p.manyToOne([EntityB, EntityC]),
    otherProperty: p.string().nullable(),
  },
});

export class Owner2 extends Owner2Schema.class {}
Owner2Schema.setClass(Owner2);

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    dbName: ":memory:",
    entities: [EntityAWithFilter, EntityB, EntityC, Owner1, Owner2],
    debug: ["query", "query-params"],
    allowGlobalContext: true, // only for testing
  });
  await orm.schema.refresh();
});

afterAll(async () => {
  await orm.close(true);
});

test("FAILS - polymorphic relation referencing an entity with default filter", async () => {
  const entityA = new EntityAWithFilter();
  const owner1 = new Owner1();
  owner1.poly = entityA;
  orm.em.persist([entityA, owner1]);
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  // EntityA filter applied
  // inner join `entity_awith_filter` as `p1` on `o0`.`poly_id` = `p1`.`id` and `o0`.`poly_type` = 'entity_awith_filter' and `p1`.`deleted_at` is null
  const foundEntity = await forkedEm.findOneOrFail(Owner1, {
    id: owner1.id,
  });

  // Polymorphic relationship NOT loaded
  // Owner1 { id: 1, otherProperty: null }
  console.log(foundEntity);

  // Relation not loaded properly, poly === undefined
  console.log(foundEntity.poly);

  foundEntity.otherProperty = "update";

  // The update query then get malformed and fails, as poly is added to the payload as undefined
  // update `owner1` set `poly_type` = null, `other_property` = 'update' where `id` = 1
  await forkedEm.flush();
});

test("SILENTLY FAILS - polymorphic relation referencing an entity with default filter and populate", async () => {
  const entityA = new EntityAWithFilter();
  const owner1 = new Owner1();
  owner1.poly = entityA;
  orm.em.persist([entityA, owner1]);
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  // EntityA filter applied
  const foundEntity = await forkedEm.findOneOrFail(
    Owner1,
    {
      id: owner1.id,
    },
    // Relation to entity with default filter gets referenced if set to populate
    // But I'm guessing only if it's the single entity with default filter in the polymorphic array
    { populate: ["poly"] },
  );

  // Owner1 {
  //   id: 1,
  //   poly: EntityAWithFilter { id: 1, deletedAt: null },
  //   otherProperty: null
  // }
  console.log(foundEntity);

  foundEntity.otherProperty = "update";

  // Successful
  await forkedEm.flush();
});

test("FAILS - polymorphic relation referencing another of the entities", async () => {
  const entityB = new EntityB();
  const owner1 = new Owner1();
  owner1.poly = entityB;
  orm.em.persist([entityB, owner1]);
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  // NotFoundError as the where clause inherits the default filter of EntityA
  const foundEntity = await forkedEm.findOneOrFail(Owner1, {
    id: owner1.id,
  });

  foundEntity.otherProperty = "update";

  await forkedEm.flush();
});

test("OK - polymorphic relation referencing entities without default filters", async () => {
  const entityB = new EntityB();
  const owner2 = new Owner2();
  owner2.poly = entityB;
  orm.em.persist([entityB, owner2]);
  await orm.em.flush();

  const forkedEm = orm.em.fork();

  const foundEntity = await forkedEm.findOneOrFail(Owner2, {
    id: owner2.id,
  });

  foundEntity.otherProperty = "update";

  await forkedEm.flush();
});
