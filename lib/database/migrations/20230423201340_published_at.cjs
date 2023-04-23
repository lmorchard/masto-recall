/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .raw(ALTER_TABLE_ADD_PUBLISHED_AT);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable("statuses", function (table) {
      table.dropColumn("publishedAt")
    });
};

const ALTER_TABLE_ADD_PUBLISHED_AT = `--sql
  ALTER TABLE statuses ADD COLUMN
    publishedAt DATETIME GENERATED ALWAYS AS (coalesce(
      json_extract(json, "$.created_at"),
      json_extract(json, "$.object.published"),
      json_extract(json, "$.published")
    )) VIRTUAL
`;
