const INDEX_COLUMNS = [
  ["id", "publishedAt"],
  "summary",
  "content",
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .renameTable("statuses", "oldStatuses")
    .raw(CREATE_TABLE_NEW_STATUSES)
    .dropTable("statusesSearch")  
    .alterTable("statuses", function (table) {
      for (let idx = 0; idx < INDEX_COLUMNS.length; idx++) {
        table.index(INDEX_COLUMNS[idx], `statuses_v3_index_${idx}`);
      }
    })
    .raw(CREATE_TABLE_STATUSES_SEARCH)
    .raw(CREATE_TRIGGER_STATUSES_INSERT)
    .raw(CREATE_TRIGGER_STATUSES_DELETE)
    .raw(CREATE_TRIGGER_STATUSES_UPDATE)
    .raw(COPY_OLD_STATUSES_TO_NEW)
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTable("statuses")
    .renameTable("oldStatuses", "statuses");
};
 
const CREATE_TABLE_NEW_STATUSES = `--sql
  CREATE TABLE statuses (
      json TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      
      id TEXT GENERATED ALWAYS AS (json_extract(json, "$.id")) VIRTUAL UNIQUE,
      type TEXT GENERATED ALWAYS AS (json_extract(json, "$.type")) VIRTUAL,
      url TEXT GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.url"),
          json_extract(json, "$.url")
      )) VIRTUAL,
      summary TEXT GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.summary"),
          json_extract(json, "$.spoiler_text")
      )) VIRTUAL,
      content TEXT GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.content"),
          json_extract(json, "$.content")
      )) VIRTUAL,
      displayName TEXT GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.actor.name"),
          json_extract(json, "$.account.display_name")
      )) VIRTUAL,
      publishedAt DATETIME GENERATED ALWAYS AS (coalesce(
        json_extract(json, "$.created_at"),
        json_extract(json, "$.object.published")
      )) VIRTUAL,
      accountUrl TEXT GENERATED ALWAYS AS (coalesce(
        json_extract(json, "$.account.url"),
        json_extract(json, "$.actor.url")
      )) VIRTUAL,
      accountAvatarUrl TEXT GENERATED ALWAYS AS (coalesce(
        json_extract(json, "$.account.avatar"),
        json_extract(json, "$.actor.icon.url")
      )) VIRTUAL,
      accountName TEXT GENERATED ALWAYS AS (coalesce(
        json_extract(json, "$.account.display_name"),
        json_extract(json, "$.actor.name")
      )) VIRTUAL
  )
`;

const CREATE_TABLE_STATUSES_SEARCH = `
  CREATE VIRTUAL TABLE statusesSearch
  USING fts5(
    id UNINDEXED,
    summary,
    content
  );
`;

const COPY_OLD_STATUSES_TO_NEW = `--sql
  INSERT INTO statuses(json)
    SELECT json FROM oldStatuses;
`;

const CREATE_TRIGGER_STATUSES_INSERT = `--sql
  CREATE TRIGGER statuses_v3_insert AFTER INSERT ON statuses BEGIN
    INSERT INTO
      statusesSearch (id, summary, content)
    VALUES
      (new.id, new.summary, new.content);
  END;
`;

const CREATE_TRIGGER_STATUSES_DELETE = `--sql
  CREATE TRIGGER statuses_v3_delete AFTER DELETE ON statuses BEGIN
    DELETE FROM statusesSearch WHERE id = old.id;
  END;
`;

const CREATE_TRIGGER_STATUSES_UPDATE = `--sql
  CREATE TRIGGER statuses_v3_update AFTER UPDATE ON statuses BEGIN
    UPDATE statusesSearch
    SET 
      summary = new.summary,
      content = new.content
    WHERE id = new.id;
  END;
`;
