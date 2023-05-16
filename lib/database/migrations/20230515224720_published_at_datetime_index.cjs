/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.raw(`
    CREATE INDEX "statuses_v3_index_publishedat_datetime"
        ON "statuses" (datetime("publishedAt"))
  `);
  await knex.schema.raw(`
    CREATE INDEX "statuses_v3_index_accountUrl"
        ON "statuses" (accountUrl)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.raw(`
    DROP INDEX "statuses_v3_index_publishedat_datetime"
  `);
  await knex.schema.raw(`
    DROP INDEX "statuses_v3_index_accountUrl"
  `);
};
