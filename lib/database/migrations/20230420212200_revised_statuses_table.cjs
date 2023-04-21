const INDEX_COLUMNS = [
  "id",
  "sensitive",
  "visibility",
  "acct",
  "statusCreatedAt",
  "inReplyToId",
  "inReplyToAccountId",
  ["visibility", "statusCreatedAt"],
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  return knex.schema
    .raw(CREATE_TABLE_NEW_STATUSES)
    .alterTable("newStatuses", function (table) {
      for (const columnName of INDEX_COLUMNS) {
        table.index(columnName);
      }
    })
    .raw(COPY_OLD_STATUSES_TO_NEW)
    .renameTable("statuses", "oldStatuses")
    .renameTable("newStatuses", "statuses")
    .raw(CREATE_TRIGGER_STATUSES_INSERT)
    .raw(CREATE_TRIGGER_STATUSES_DELETE)
    .raw(CREATE_TRIGGER_STATUSES_UPDATE);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTable("newStatuses")
    .renameTable("oldStatuses", "statuses");
};
  
const CREATE_TABLE_NEW_STATUSES = `--sql
  CREATE TABLE newStatuses (
      json TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      
      -- union between activitypub and mastodon
      id VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.id")) VIRTUAL UNIQUE,
      type VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.type")) VIRTUAL,
      url VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.url"),
          json_extract(json, "$.url")
      )) VIRTUAL,
      summary VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.summary"),
          json_extract(json, "$.spoiler_text")
      )) VIRTUAL,
      content VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.object.content"),
          json_extract(json, "$.content")
      )) VIRTUAL,
      displayName VARCHAR(255) GENERATED ALWAYS AS (coalesce(
          json_extract(json, "$.actor.name"),
          json_extract(json, "$.account.display_name")
      )) VIRTUAL,

      -- mastodon specific
      sensitive BOOLEAN GENERATED ALWAYS AS (json_extract(json, "$.sensitive")) VIRTUAL,
      visibility VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.visibility")) VIRTUAL,
      acct VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.account.acct")) VIRTUAL,
      spoilerText VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.spoiler_text")) VIRTUAL,
      inReplyToId VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.in_reply_to_id")) VIRTUAL,
      inReplyToAccountId VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.in_reply_to_account_id")) VIRTUAL,
      statusCreatedAt VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.created_at")) VIRTUAL,

      -- activitypub specific
      activityType VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.type")) VIRTUAL,
      activityPublished VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.published")) VIRTUAL,
      objectType VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.object.type")) VIRTUAL,
      objectPublished VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.object.published")) VIRTUAL,
      objectAttributedTo VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.object.attributedTo")) VIRTUAL,
      objectInReplyTo VARCHAR(255) GENERATED ALWAYS AS (json_extract(json, "$.object.inReplyTo")) VIRTUAL
  )
`;

const COPY_OLD_STATUSES_TO_NEW = `--sql
  INSERT INTO newStatuses(json)
  SELECT json FROM statuses;
`;

const CREATE_TRIGGER_STATUSES_INSERT = `--sql
  CREATE TRIGGER statuses_insert_2 AFTER INSERT ON statuses BEGIN
    INSERT INTO
      statusesSearch (id, spoilerText, content)
    VALUES (
      new.id,
      new.spoilerText,
      new.content
    );
  END;
`;

const CREATE_TRIGGER_STATUSES_DELETE = `--sql
  CREATE TRIGGER statuses_delete_2 AFTER DELETE ON statuses BEGIN
    DELETE FROM statusesSearch WHERE id = old.id;
  END;
`;

const CREATE_TRIGGER_STATUSES_UPDATE = `--sql
  CREATE TRIGGER statuses_update_2 AFTER UPDATE ON statuses BEGIN
    UPDATE statusesSearch
    SET 
      spoilerText = new.spoilerText,
      content = new.content
    WHERE id = new.id;
  END;
`;