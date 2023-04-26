const INDEX_COLUMNS = [
    "content",
  ];
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.up = async function (knex) {
    return knex.schema.alterTable("statuses", function (table) {
      for (const columnName of INDEX_COLUMNS) {
        table.index(columnName);
      }
    });
  };
  
  /**
   * @param { import("knex").Knex } knex
   * @returns { Promise<void> }
   */
  exports.down = function (knex) {
    return knex.schema.alterTable("statuses", function (table) {
      for (const columnName of INDEX_COLUMNS) {
        table.dropIndex(columnName);
      }
    });
  };
  