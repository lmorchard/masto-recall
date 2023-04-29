/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema.raw(`--sql
    ALTER TABLE links
      ADD COLUMN accountUrl TEXT GENERATED ALWAYS AS (json_extract(json, "$.accountUrl"));
  `).raw(`--sql
    ALTER TABLE links
      ADD COLUMN seenAt DATETIME GENERATED ALWAYS AS (json_extract(json, "$.seenAt"));
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  throw new Error("cannot reverse migration");
};
