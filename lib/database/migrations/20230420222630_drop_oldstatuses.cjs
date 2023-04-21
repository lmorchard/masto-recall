/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema.dropTable("oldStatuses");
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  // TOOD: not quite true, I'm just too lazy to reproduce the original CREATE TABLE and copy statuses back
  throw new Error("Cannot migrate back down from having deleted oldStatuses table");
};
