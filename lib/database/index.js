import Knex from "knex";
import LiQuery from "liquery";

import BasePlugin from "../base.js";
import DatabaseKnexPlugin from "./knex.js";
import DatabaseCommandsPlugin from "./commands.js";

export default class DatabasePlugin extends BasePlugin {
  static configSchema = {
    databasePath: {
      doc: "Path to the sqlite database",
      env: "DATABASE_PATH",
      format: String,
      default: "data.sqlite3",
    },
    databaseJournalMode: {
      doc: "Journal mode for SQLite",
      env: "DATABASE_JOURNAL_MODE",
      format: String,
      default: "WAL",
    },
    databaseBusyTimeout: {
      doc: "Time (in ms) for SQLite busy_timeout",
      env: "DATABASE_BUSY_TIMEOUT",
      format: Number,
      default: 1000,
    },
    databaseMaxConnections: {
      doc: "Database max connections",
      env: "DATABASE_MAX_CONNECTIONS",
      format: Number,
      default: 16,
    },
    databaseWriteBatchPeriod: {
      doc: "Minimum period to wait between committing writes in transaction batches",
      env: "DATABASE_WRITE_BATCH_PERIOD",
      format: Number,
      default: 5000,
    },
  };

  constructor(parent) {
    super(parent);
    this.commands = new DatabaseCommandsPlugin(parent);
    this.knex = new DatabaseKnexPlugin(parent);
    this.liquery = new LiQuery({
      table: "statuses",
      primary: "id",
      search: "content",
      select: ["*"],
      count: ["COUNT(id) AS count"],
      default: "publishedat:desc",
      allowed: [
        "publishedat",
        "content",
        "accountname",
        "accounturl",
        "type",
        "json",
        "url",
        "summary",
        "displayname",
        "sensitive",
        "visibility",
        "spoilertext",
        "activitytype",
        "objecttype",
      ],
      debug: true,
    });
  }

  async preAction() {
    await this.buildDatabaseConnections();
    await this.setupWriteQueue();
    await this.fetchConfigFromDB();
  }

  async buildDatabaseConnections() {
    const { config } = this.parent;
    const log = this.log;

    this.connection = Knex({
      client: "sqlite3",
      useNullAsDefault: true,
      connection: {
        filename: config.get("databasePath"),
      },
      pool: {
        min: 1,
        max: config.get("databaseMaxConnections"),
        afterCreate: function (conn, done) {
          const statements = [
            `PRAGMA journal_mode=${config.get("databaseJournalMode")};`,
            `PRAGMA busy_timeout=${config.get("databaseBusyTimeout")};`,
          ];
          const runNext = () => {
            const statement = statements.shift();
            log.trace({ msg: "afterCreateSetup", statement });
            conn.run(statement, (err) => {
              if (err || statements.length == 0) {
                return done(err, conn);
              }
              runNext();
            });
          };
          runNext();
        },
      },
    });
  }

  async fetchConfigFromDB() {
    const { config } = this.parent;
    try {
      config.setAll(await this.getAllConfig());
    } catch (error) {
      // If `init` command hasn't been run yet, we won't have this table.
      if (!/no such table: config/.test(error.message)) {
        throw error;
      }
    }
  }

  async deinit() {
    if (this.connection) {
      this.connection.destroy();
    }
  }

  async postAction() {
    return this.deinit();
  }

  async setConfig(configObject = {}) {
    for (const [name, value] of Object.entries(configObject)) {
      await this.connection("config")
        .insert({ name, value })
        .onConflict("name")
        .merge();
    }
  }

  async resetConfig(name) {
    return this.connection("config").delete().where({ name });
  }

  async getConfig(name) {
    const result = await this.connection("config")
      .first("value")
      .where({ name });
    return result && result.value;
  }

  async getAllConfig() {
    return this.connection("config").select("name", "value");
  }

  async importActivity(activity) {
    // TODO: same as putStatusFromPayload, for now. may soon vary
    const json = JSON.stringify(activity, null, "  ");
    this.enqueueWrite("importActivity", { id: activity.id }, (trx) =>
      trx("statuses").insert({ json }).onConflict("id").merge()
    );
  }

  async putStatusFromPayload(payload) {
    const json = JSON.stringify(payload, null, "  ");
    this.enqueueWrite("putStatusFromPayload", { id: payload.id }, (trx) =>
      trx("statuses").insert({ json }).onConflict("id").merge()
    );
  }

  async deleteStatus(id) {
    this.enqueueWrite("deleteStatus", { id }, (trx) =>
      trx("statuses").delete().where({ id })
    );
  }

  async setupWriteQueue() {
    this.enableAutoCommit = true;
    this.writeBuffer = [];
    this.lastWriteTime = Date.now();
    this.writeInProgress = false;
  }

  /**
   * Enqueue write for eventual execution in a transaction batch.
   *
   * @param {string} name
   * @param {object} idData
   * @param {Function} writeFn
   */
  async enqueueWrite(name, idData, writeFn) {
    const log = this.log;

    log.trace({ msg: "enqueueWrite", type: name, ...idData });
    this.writeBuffer.push(writeFn);
    this.maybeCommitWrites();
  }

  /**
   * Commit a batch of writes in a transaction, if necessary.
   *
   * Since SQLite's full text search index does housekeeping at the end of
   * each transaction, it's more efficient to batch up many writes rather
   * than trying to perform them one at a time.
   */
  async maybeCommitWrites() {
    const { config } = this.parent;

    if (!this.enableAutoCommit) {
      return;
    }

    // Wait a bit between batches, per config
    const minWritePeriod = config.get("databaseWriteBatchPeriod");
    const sinceLastWritePeriod = Date.now() - this.lastWriteTime;
    if (sinceLastWritePeriod < minWritePeriod) {
      return;
    }

    // Don't allow concurrent writes - SQLite wants a single writer
    if (this.writeInProgress) return false;
    this.writeInProgress = true;

    // Okay, here we go...
    this.commitWrites();

    // Clean up after ourselves and unlock for next batch
    this.lastWriteTime = Date.now();
    this.writeInProgress = false;
  }

  async commitWrites() {
    const log = this.log;
    const sinceLastWritePeriod = Date.now() - this.lastWriteTime;

    // Copy the current batch and empty out the buffer before we start
    // awaiting any database operations
    const batch = [...this.writeBuffer];
    this.writeBuffer.length = 0;

    const performStart = Date.now();
    try {
      // Perform the writes in a new transaction and measure duration
      await this.connection.transaction(async (trx) => {
        for (const writeFn of batch) {
          await writeFn(trx);
        }
      });
      log.info({
        msg: "commit",
        sinceLastWritePeriod,
        batchSize: batch.length,
        duration: Date.now() - performStart,
      });
    } catch (error) {
      // TODO: we just throw away the batch at this point, maybe retry? try to recover?
      log.error({
        msg: "commitFailed",
        sinceLastWritePeriod,
        batchSize: batch.length,
        duration: Date.now() - performStart,
        error,
      });
    }
  }

  async searchStatuses(searchQuery, options = {}) {
    const { connection, log } = this;
    const {
      limit = 100,
      offset = 0,
      orderBy = "publishedAt",
      orderDirection = "desc",
    } = options;

    const q = this.liquery.parse(searchQuery, {
      limit,
      page: offset / limit,
    });

    log.debug({
      msg: "liquery",
      select: q.sql.select,
      count: q.sql.count,
      errors: q.errors,
    });

    const [count, results] = await Promise.all([
      connection.raw(q.sql.count),
      connection.raw(q.sql.select),
    ]);

    return {
      count: count[0].count,
      results: this.filterStatusResults(results),
      resultsSql: q.sql.select,
    };

    /*
    return this.queryStatusResults(
      connection("statuses").where(
        "statuses.id",
        "IN",
        connection("statusesSearch")
          .select("id")
          .where("statusesSearch", "MATCH", searchQuery)
      ),
      options
    );
    */
  }

  async recentStatuses(options) {
    return this.queryStatusResults(this.connection("statuses"), options);
  }

  async queryStatusResults(
    baseQuery,
    {
      limit = 100,
      offset = 0,
      orderBy = "publishedAt",
      orderDirection = "desc",
    } = {}
  ) {
    const countQuery = baseQuery.clone().count({ count: "*" }).first();
    const resultsQuery = baseQuery
      .clone()
      .orderBy(`statuses.${orderBy}`, orderDirection)
      .limit(limit)
      .offset(offset);
    const [count, results] = await Promise.all([countQuery, resultsQuery]);
    return {
      count: count.count,
      results: this.filterStatusResults(results),
    };
  }

  filterStatusResults(results) {
    return (
      results
        .map((status) => ({
          ...status,
          ...JSON.parse(status.json),
        }))
        // TODO: fix this at the ingest level - we maybe don't want to index boosts, need to render them distinctly at least
        .filter((status) => status.reblog == null)
    );
  }

  async getStatistics() {
    const { connection } = this;
    const stats = {};
    /*
    stats.statuses = (
      await connection("statuses").count({ count: "*" }).first()
    ).count;
    stats.accounts = (
      await connection("statuses").countDistinct({ count: "acct" }).first()
    ).count;
    */
    return stats;
  }
}
