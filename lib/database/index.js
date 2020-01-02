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
  };

  constructor(parent) {
    super(parent);
    this.commands = new DatabaseCommandsPlugin(parent);
    this.knex = new DatabaseKnexPlugin(parent);
  }

  async preAction() {
    const { config } = this.parent;

    this.connection = Knex({
      client: "sqlite3",
      useNullAsDefault: true,
      connection: {
        filename: config.get("databasePath"),
      },
    });

    // Set config values from database, now that we have a connection
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

  tableConfig() {
    return this.connection("config");
  }

  async setConfig(configObject = {}) {
    for (const [name, value] of Object.entries(configObject)) {
      await this.tableConfig()
        .insert({ name, value })
        .onConflict("name")
        .merge();
    }
  }

  async resetConfig(name) {
    return this.tableConfig().delete().where({ name });
  }

  async getConfig(name) {
    const result = await this.tableConfig().first("value").where({ name });
    return result && result.value;
  }

  async getAllConfig() {
    return this.tableConfig().select("name", "value");
  }

  tableStatuses() {
    return this.connection("statuses");
  }

  async putStatusFromPayload(payload) {
    return await this.tableStatuses()
      .insert({
        json: JSON.stringify(payload, null, "  "),
      })
      .onConflict("id")
      .merge();
  }

  async deleteStatus(id) {
    return await this.tableStatuses().delete().where({ id });
  }

  tableStatusesSearch() {
    return this.connection("statusesSearch");
  }

  async searchStatuses(
    searchQuery,
    {
      limit = 100,
      offset = 0,
      orderBy = "statusCreatedAt",
      orderDirection = "desc",
    } = {}
  ) {
    const baseQuery = this.tableStatusesSearch()
      .join("statuses", "statusesSearch.id", "=", "statuses.id")
      .where("statusesSearch", "MATCH", searchQuery)
      .andWhere("statuses.visibility", "public");
    const [count, results] = await Promise.all([
      baseQuery.clone().count({ count: "statuses.id" }).first(),
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
    return {
      statuses: (await this.tableStatuses().count({ count: "*" }).first())
        .count,
        /*
      accounts: (
        await this.tableStatuses().countDistinct({ count: "acct" }).first()
      ).count,
      */
    };
  }
}
