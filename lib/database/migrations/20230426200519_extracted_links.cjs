/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .raw(CREATE_TABLE_LINKS)
    .alterTable("links", function (table) {
      table.unique(["statusId", "normalized"], { indexName: "linux_unique_statusid_normalized" });
      table.index(["id", "normalized"], "links_normalized_index");
      table.index(["id", "statusId", "normalized"], "links_statusid_normalized_index");
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTable("links")
};
  
const CREATE_TABLE_LINKS = `--sql
  CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      json TEXT,
      statusId TEXT GENERATED ALWAYS AS (json_extract(json, "$.statusId")) VIRTUAL,
      normalized TEXT GENERATED ALWAYS AS (json_extract(json, "$.normalized")) VIRTUAL,
      href TEXT GENERATED ALWAYS AS (json_extract(json, "$.normalized")) VIRTUAL
  )
`;
