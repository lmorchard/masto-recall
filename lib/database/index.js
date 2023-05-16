import Knex from "knex";
import LiQuery from "liquery";

import BasePlugin from "../base.js";
import DatabaseKnexPlugin from "./knex.js";
import DatabaseCommandsPlugin from "./commands.js";
import DatabaseWriteQueuePlugin from "./writeQueue.js";

export default class DatabasePlugin extends BasePlugin {
  static configSchema = {
    databasePath: {
      doc: "Path to the sqlite database",
      env: "DATABASE_PATH",
      format: String,
      default: "data.sqlite3",
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
    this.writeQueue = new DatabaseWriteQueuePlugin(parent);

    this.lastOptimizeTime = Date.now();

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

  get connection() {
    const { config } = this.parent;
    const log = this.log;

    if (!this._connection) {
      log.trace({ msg: "buildDatabaseConnection" });

      this._connection = Knex({
        client: "sqlite3",
        useNullAsDefault: true,
        connection: {
          filename: config.get("databasePath"),
        },
        pool: {
          min: 1,
          max: config.get("databaseMaxConnections"),
          afterCreate: this.connectionAfterCreate.bind(this),
        },
      });
    }

    return this._connection;
  }

  connectionAfterCreate(conn, done) {
    const { config } = this.parent;
    const log = this.log;

    // Cribbing some notes from here https://phiresky.github.io/blog/2020/sqlite-performance-tuning/
    const statements = `
      PRAGMA busy_timeout = ${config.get("databaseBusyTimeout")};
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = normal;
      PRAGMA temp_store = memory;
      PRAGMA mmap_size = 30000000000;
      PRAGMA page_size = 32768;
    `
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // HACK: This feels grungy, but seems like a not-absolutely-terrible way to run these statements?
    // https://knexjs.org/guide/#aftercreate
    const runNext = () => {
      const statement = statements.shift();
      log.trace({ msg: "connectionAfterCreate", statement });
      conn.run(statement, (err) =>
        err || statements.length == 0 ? done(err, conn) : runNext()
      );
    };
    runNext();
  }

  async deinit() {
    if (this._connection) {
      this._connection.destroy();
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
    this.writeQueue.enqueue("importActivity", { id: activity.id }, (trx) =>
      trx("statuses").insert({ json }).onConflict("id").merge()
    );
  }

  async putStatusFromPayload(payload) {
    const json = JSON.stringify(payload, null, "  ");
    this.writeQueue.enqueue("putStatusFromPayload", { id: payload.id }, (trx) =>
      trx("statuses").insert({ json }).onConflict("id").merge()
    );
  }

  async deleteStatus(id) {
    this.writeQueue.enqueue("deleteStatus", { id }, (trx) =>
      trx("statuses").delete().where({ id })
    );
  }

  async getStatus(id) {
    return this.connection("statuses").where("id", id).first();
  }

  async putLink(link) {
    const json = JSON.stringify(link, null, "  ");
    this.writeQueue.enqueue(
      "putLink",
      { id: `${link.statusId}|${link.normalized}` },
      (trx) =>
        trx("links")
          .insert({ json })
          .onConflict(["statusId", "normalized"])
          .merge()
    );
  }

  async fetchTopRecentLinks({ hours = 12, limit = 25 }) {
    const timeRange = `-${hours} hours`;
    return this.connection.raw(
      `--sql
      select
        count(distinct accountUrl) as accountCount,
        seenAt,
        normalized
      from links 
      group by normalized
      having datetime(min(seenAt)) > datetime("now", ?)
      order by accountCount desc
      limit ?;
    `,
      [timeRange, limit]
    );
  }

  async fetchStatusesForTopRecentLinks({ hours = 12, limit = 25 }) {
    const timeRange = `-${hours} hours`;
    return this.connection.raw(
      `--sql
      select
        normalized,
        statuses.*
      from links
      join statuses on statuses.id = links.statusId
      where links.normalized in (
        select normalized
        from links 
        group by normalized
        having datetime(min(seenAt)) > datetime("now", ?)
        order by count(distinct accountUrl) desc
        limit ?
      )
      order by publishedAt desc;
    `,
      [timeRange, limit]
    );
  }

  async searchStatuses_liquery(searchQuery, options = {}) {
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
  }

  async searchStatuses_fts(searchQuery, options = {}) {
    const { log, connection } = this;
    const baseQuery = connection("statuses").where(
      "statuses.id",
      "IN",
      connection("statusesSearch")
        .select("id")
        .where("statusesSearch", "MATCH", searchQuery)
    );
    return this.queryStatusResults(baseQuery, options);
  }

  async recentStatuses(options) {
    return this.queryStatusResults(this.connection("statuses"), options);
  }

  async queryStatusResults(
    baseQuery,
    {
      limit = 30,
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
    const resultsSql = resultsQuery.toString();
    const [count, results] = await Promise.all([countQuery, resultsQuery]);
    return {
      count: count.count,
      results: this.filterStatusResults(results),
      resultsSql,
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
    return {
      statuses: (await connection("statuses").count({ count: "*" }).first())
        .count,
      accounts: (
        await connection.raw(
          `select count(*) as count from ( select distinct accountUrl from statuses );`
        )
      )[0].count,
    };
  }
}
