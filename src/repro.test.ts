import { SqliteDriver, defineEntity, MikroORM, p } from "@mikro-orm/sqlite";
import type { Dictionary, FilterDef } from "@mikro-orm/core";

/**
 * Reproduces: polymorphic manyToOne targeting TPT sub-class entities resolves
 * default filter conditions against the child sub-table alias instead of the
 * parent table that owns the referenced column.
 *
 * The filter in this example references an embedded property (`audit.deletedAt`),
 * which MikroORM resolves to `audit_deleted_at`. In TPT, that column lives on
 * the parent table ("device") only — not on the child sub-tables. The same crash
 * occurs with any default filter whose condition references a parent-table-only
 * column; soft-delete is used here as a concrete, reproducible instance.
 *
 * Related issues — each fixed a part of this, but the combination is still broken:
 *   - #7317 (polymorphic + default filter)  → fixed v7.0.3  by PR #7332
 *   - #7563 (polymorphic + TPT targets)     → fixed v7.0.11 by PR #7564
 */

// ─── Embeddable with the soft-delete timestamp ────────────────────────────────

const AuditEmbeddableSchema = defineEntity({
  name: "AuditEmbeddable",
  embeddable: true,
  properties: {
    deletedAt: p.datetime().nullable(),
  },
});
class AuditEmbeddable extends AuditEmbeddableSchema.class {}
AuditEmbeddableSchema.setClass(AuditEmbeddable);

// ─── Default filter on parent entity ─────────────────────────────────────────
// Any default filter whose cond references a parent-table-only column triggers
// the bug. Soft-delete via an embedded property is used here as a concrete
// example: MikroORM resolves `{ audit: { deletedAt: null } }` to the column
// `audit_deleted_at`, which lives on the parent table only.

const PARENT_COLUMN_FILTER: Dictionary<FilterDef> = {
  excludeSoftDeleted: {
    name: "excludeSoftDeleted",
    cond: { audit: { deletedAt: null } },
    default: true,
  },
};

// ─── Abstract parent TPT entity ──────────────────────────────────────────────
// `audit_deleted_at` lives in THIS table ("device").
// Child sub-tables are not created with this column.

const DeviceSchema = defineEntity({
  name: "Device",
  tableName: "device",
  abstract: true,
  inheritance: "tpt",
  filters: { ...PARENT_COLUMN_FILTER },
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    audit: () =>
      p.embedded(AuditEmbeddable).onCreate(() => new AuditEmbeddable()),
  },
});
class Device extends DeviceSchema.class {}
DeviceSchema.setClass(Device);

// ─── Child TPT entities ───────────────────────────────────────────────────────
// Sub-tables only hold `id` — NOT `audit_deleted_at`.
// Each declares the inverse of the polymorphic relation.

const DeviceASchema = defineEntity({
  name: "DeviceA",
  tableName: "device_a",
  extends: Device,
  properties: {
    id: p.integer().primary(),
    parts: () => p.oneToMany(Part).mappedBy("parentDevice"),
  },
});
class DeviceA extends DeviceASchema.class {}
DeviceASchema.setClass(DeviceA);

const DeviceBSchema = defineEntity({
  name: "DeviceB",
  tableName: "device_b",
  extends: Device,
  properties: {
    id: p.integer().primary(),
    parts: () => p.oneToMany(Part).mappedBy("parentDevice"),
  },
});
class DeviceB extends DeviceBSchema.class {}
DeviceBSchema.setClass(DeviceB);

// ─── Owning side: polymorphic manyToOne ───────────────────────────────────────
// MikroORM stores a discriminator column (`parent_device_type`) alongside the FK.

const PartSchema = defineEntity({
  name: "Part",
  tableName: "part",
  properties: {
    id: p.integer().primary(),
    parentDevice: () => p.manyToOne([DeviceA, DeviceB]).ref(),
  },
});
class Part extends PartSchema.class {}
PartSchema.setClass(Part);

// ─── ORM lifecycle ────────────────────────────────────────────────────────────

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    driver: SqliteDriver,
    dbName: ":memory:",
    entities: [AuditEmbeddable, Device, DeviceA, DeviceB, Part],
    allowGlobalContext: true,
  });
  await orm.schema.create();

  const device = orm.em.create(DeviceA, { name: "device-1" });
  await orm.em.flush();
  orm.em.create(Part, { parentDevice: device });
  await orm.em.flush();
  orm.em.clear();
});

afterAll(async () => {
  await orm.close(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("audit_deleted_at should be a column of the parent 'device' table only", async () => {
  const sql = await orm.schema.getCreateSchemaSQL();
  // Baseline: confirms audit_deleted_at is a TPT parent-only column.
  expect(sql).toMatch(/create table `device`[^;]*`audit_deleted_at`/is);
  expect(sql).not.toMatch(/create table `device_a`[^;]*`audit_deleted_at`/is);
  expect(sql).not.toMatch(/create table `device_b`[^;]*`audit_deleted_at`/is);
});

test("populating the inverse polymorphic collection should not throw", async () => {
  // When EntityLoader populates DeviceA.parts, it issues a child-find for Part
  // records. Because Part.parentDevice is polymorphic ([DeviceA, DeviceB]),
  // MikroORM JOINs both sub-tables and applies their inherited default filter,
  // generating:
  //
  //   LEFT JOIN `device_a` AS `d0`
  //     ON `part`.`parent_device_id` = `d0`.`id`
  //     AND `part`.`parent_device_type` = 'device_a'
  //     AND `d0`.`audit_deleted_at` IS NULL   ← column does not exist on device_a
  //   LEFT JOIN `device_b` AS `d1`
  //     ON `part`.`parent_device_id` = `d1`.`id`
  //     AND `part`.`parent_device_type` = 'device_b'
  //     AND `d1`.`audit_deleted_at` IS NULL   ← column does not exist on device_b
  //
  // BUG: `audit_deleted_at` lives on the parent `device` table (via the
  // embedded `audit` property). Referencing it on a child sub-table alias
  // throws "no such column: d0.audit_deleted_at".
  await expect(
    orm.em.find(DeviceA, {}, { populate: ["parts"] }),
  ).resolves.not.toThrow();
});
