import path from "path";

import Knex from "knex";

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
      default: 1000,
    },
  };

  constructor(parent) {
    super(parent);
    this.commands = new DatabaseCommandsPlugin(parent);
    this.knex = new DatabaseKnexPlugin(parent);
  }

  async preAction() {
    await this.buildDatabaseConnections();
    await this.fetchConfigFromDB();
  }

  async buildDatabaseConnections() {
    const { config } = this.parent;
    const log = this.log;

    this.writeBuffer = [];
    this.lastWriteTime = Date.now();
    this.writeInProgress = false;

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
          conn.run(
            `PRAGMA journal_mode=${config.get("databaseJournalMode")};`,
            (err) => {
              if (err) return done(err, conn);
              conn.run(
                `PRAGMA busy_timeout=${config.get("databaseBusyTimeout")};`,
                (err) => {
                  log.trace({ msg: "database connection afterCreate", conn });
                  done(err, conn);
                }
              );
            }
          );
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

  /**
   * Enqueue write for eventual execution in a transaction batch.
   * 
   * @param {string} name 
   * @param {object} idData 
   * @param {Function} writeFn 
   */
  async enqueueWrite(name, idData, writeFn) {
    const { config } = this.parent;
    const log = this.log;

    this.writeBuffer.push(writeFn);
    log.trace({ msg: "enqueueWrite", type: name, ...idData });

    if (!this.writeInProgress) {
      const minWritePeriod = config.get("databaseWriteBatchPeriod");
      const sinceLastWritePeriod = Date.now() - this.lastWriteTime;
      if (sinceLastWritePeriod > minWritePeriod) {
        this.commitWrites();
      }  
    }
  }

  /**
   * Commit a batch of writes in a transaction.
   * 
   * Since SQLite's full text search index does housekeeping at the end of
   * each transaction, it's more efficient to batch up many writes rather 
   * than trying to perform them one at a time.
   */
  async commitWrites() {
    const log = this.log;

    this.writeInProgress = true;

    const batch = [...this.writeBuffer];
    this.writeBuffer.length = 0;

    const sinceLastWritePeriod = Date.now() - this.lastWriteTime;
    const performStart = Date.now();
    await this.connection.transaction(async (trx) => {
      for (const writeFn of batch) {
        await writeFn(trx);
      }
    });

    log.info({
      msg: "commitWrites",
      sinceLastWritePeriod,
      batchSize: batch.length,
      duration: Date.now() - performStart,
    });

    this.lastWriteTime = Date.now();
    this.writeInProgress = false;
  }

  async searchStatuses(searchQuery, options) {
    const baseQuery = this.connection("statusesSearch")
      .join("statuses", "statusesSearch.id", "=", "statuses.id")
      .where("statusesSearch", "MATCH", searchQuery)
      .andWhere("statuses.visibility", "public");
    return this.queryStatusResults(baseQuery, options);
  }

  async recentStatuses(options) {
    const baseQuery = this.connection("statuses").where(
      "statuses.visibility",
      "public"
    );
    return this.queryStatusResults(baseQuery, options);
  }

  async queryStatusResults(
    baseQuery,
    {
      limit = 100,
      offset = 0,
      orderBy = "statusCreatedAt",
      orderDirection = "desc",
    } = {}
  ) {
    const [count, results] = await Promise.all([
      baseQuery.clone().count({ count: "*" }).first(),
      baseQuery
        .clone()
        .orderBy(`statuses.${orderBy}`, orderDirection)
        .limit(limit)
        .offset(offset),
    ]);
    return {
      count: count.count,
      results: results
        .map((status) => ({
          ...status,
          ...JSON.parse(status.json),
        }))
        // TODO: fix this at the ingest level - we maybe don't want to index boosts, need to render them distinctly at least
        .filter((status) => status.reblog == null),
    };    
  }

  async getStatistics() {
    const { connection } = this;
    const statuses = (
      await this.connection("statuses").count({ count: "*" }).first()
    ).count;
    const accounts = (
      await this.connection("statuses").countDistinct({ count: "acct" }).first()
    ).count;
    return {
      statuses,
      accounts,
    };
  }
}
