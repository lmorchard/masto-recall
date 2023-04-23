/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .raw(`--sql
      ALTER TABLE statuses ADD COLUMN
        accountUrl VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.account.url"),
          json_extract(json, "$.actor.url")
        )) VIRTUAL
    `)
    .raw(`--sql
      ALTER TABLE statuses ADD COLUMN
        accountAvatarUrl VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.account.avatar"),
          json_extract(json, "$.actor.icon.url")
        )) VIRTUAL
    `)
    .raw(`--sql
      ALTER TABLE statuses ADD COLUMN
        accountName VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.account.display_name"),
          json_extract(json, "$.actor.name")
        )) VIRTUAL
    `)
    ;
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable("statuses", function (table) {
      table
        .dropColumn("accountUrl")
        .dropColumn("accountAvatarUrl")
        .dropColumn("accountName")
    });
};
