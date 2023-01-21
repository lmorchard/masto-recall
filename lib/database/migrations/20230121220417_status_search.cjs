/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .raw(CREATE_TABLE_STATUSES)
    .raw(CREATE_TABLE_STATUSES_SEARCH)
    .raw(CREATE_TRIGGER_STATUSES_INSERT)
    .raw(CREATE_TRIGGER_STATUSES_DELETE)
    .raw(CREATE_TRIGGER_STATUSES_UPDATE);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable("statuses").dropTable("statusesSearch");
};

const CREATE_TABLE_STATUSES = `--sql
  CREATE TABLE statuses (
    json TEXT,

    id VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.id")) STORED UNIQUE,
    sensitive BOOLEAN GENERATED ALWAYS AS (json_extract(json, "$.sensitive")) STORED,
    visibility VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.visibility")) STORED,
    url VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.url")) STORED,
    spoilerText VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.spoiler_text")) STORED,
    content VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.content")) STORED,
    acct VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.account.acct")) STORED,
    displayName VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.account.display_name")) STORED,
    inReplyToId VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.in_reply_to_id")) STORED,
    inReplyToAccountId VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.in_reply_to_account_id")) STORED,
    statusCreatedAt VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.created_at")) STORED
  )
`;

const CREATE_TABLE_STATUSES_SEARCH = `
  CREATE VIRTUAL TABLE statusesSearch
  USING fts5(
    id UNINDEXED,
    spoilerText,
    content
  );
`;

const CREATE_TRIGGER_STATUSES_INSERT = `
  CREATE TRIGGER statuses_insert AFTER INSERT ON statuses BEGIN
    INSERT INTO
      statusesSearch (id, spoilerText, content)
    VALUES (
      new.id,
      new.spoilerText,
      new.content
    );
  END;
`;

const CREATE_TRIGGER_STATUSES_DELETE = `
  CREATE TRIGGER statuses_delete AFTER DELETE ON statuses BEGIN
    DELETE FROM statusesSearch WHERE id = old.id;
  END;
`;

const CREATE_TRIGGER_STATUSES_UPDATE = `
  CREATE TRIGGER statuses_update AFTER UPDATE ON statuses BEGIN
    UPDATE statusesSearch
    SET 
      spoilerText = new.spoilerText,
      content = new.content
    WHERE id = new.id;
  END;
`;
