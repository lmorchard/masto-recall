/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema.alterTable("statuses", function (table) {
    table.index(['publishedAt', 'id'], 'statuses_v3_index_publishedat_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable("statuses", function (table) {
    table.dropIndex('statuses_v3_index_publishedat_id');
  });
};
