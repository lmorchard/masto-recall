import path from "path";

import Knex from "knex";

import BasePlugin from "../base.js";
import DatabaseKnexPlugin from "./knex.js";
import DatabaseCommandsPlugin from "./commands.js";

import PQueue from "p-queue";

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
  };

  constructor(parent) {
    super(parent);
    this.commands = new DatabaseCommandsPlugin(parent);
    this.knex = new DatabaseKnexPlugin(parent);
  }

  async preAction() {
    await this.buildWriteQueue();
    await this.buildDatabaseConnections();
    await this.fetchConfigFromDB();
  }

  async buildWriteQueue() {
    const log = this.log;
    const writeQueue = (this.writeQueue = new PQueue({ concurrency: 1 }));
    writeQueue.on("next", () => {
      const { size, pending } = writeQueue;
      if (size == 0 || pending == 0) return;
      log.info({ msg: "write queue next", size, pending });
    });
    writeQueue.on("active", () => {
      const { size, pending } = writeQueue;
      log.trace({ msg: "write queue active", size, pending });
    });
    writeQueue.on("completed", (result) => {
      const { size, pending } = writeQueue;
      log.trace({ msg: "write queue completed", size, pending, result });
    });
    writeQueue.on("error", (error) => {
      const { size, pending } = writeQueue;
      log.trace({ msg: "write queue error", size, pending, error });
    });
    writeQueue.on("empty", () => {
      log.trace({ msg: "write queue empty" });
    });
    writeQueue.on("idle", () => {
      log.trace({ msg: "write queue idle" });
    });
  }

  async buildDatabaseConnections() {
    const { config } = this.parent;
    const log = this.log;

    const knexOptions = {
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
    };

    this.connection = Knex({ ...knexOptions });
    this.writeConnection = Knex({ ...knexOptions });
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
    if (this.writeConnection) {
      this.writeConnection.destroy();
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
    return this.writeConnection("config").delete().where({ name });
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
    return this.writeQueue.add(() =>
      this.writeConnection("statuses")
        .insert({ json: JSON.stringify(payload, null, "  ") })
        .onConflict("id")
        .merge()
    );
  }

  async deleteStatus(id) {
    return this.writeQueue.add(() =>
      this.writeConnection("statuses").delete().where({ id })
    );
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
    const statuses = (await this.connection("statuses").count({ count: "*" }).first())
      .count;
    const accounts = (
      await this.connection("statuses").countDistinct({ count: "acct" }).first()
    ).count;
    return {
      statuses,
      accounts,
    };
  }
}
