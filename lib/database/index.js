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

  async searchStatuses(searchQuery) {
    return this.tableStatusesSearch()
      .join("statuses", "statusesSearch.id", "=", "statuses.id")
      .where("statusesSearch", "MATCH", searchQuery)
      .orderBy("statusesSearch.rank");
  }
}
