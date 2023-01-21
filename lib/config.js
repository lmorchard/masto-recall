import * as dotenv from "dotenv";
import Convict from "convict";
import BasePlugin from "./base.js";

export default class ConfigPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);

    this.configSchema = {};

    const { program } = this.parent.cli;

    program.option("-F, --config <name=value...>", "set configuration values");

    const configProgram = program
      .command("config")
      .description("configuration operations");

    configProgram
      .command("show")
      .description("show current configuration")
      .action(this.runConfigShow.bind(this));

    configProgram
      .command("set <name> <value>")
      .description("set a config value in the database")
      .action(this.runConfigSet.bind(this));

    configProgram
      .command("reset <name>")
      .description("clear a config value from the database")
      .action(this.runConfigReset.bind(this));

    configProgram
      .command("get <name>")
      .description("get a config value from the database")
      .action(this.runConfigGet.bind(this));
  }

  extendSchema(schema = {}) {
    this.configSchema = {
      ...this.configSchema,
      ...schema,
    };
  }

  get(name) {
    return this.config.get(name);
  }

  set(name, value) {
    return this.config.set(name, value);
  }

  setAll(configRows) {
    const { configSchema } = this;
    for (const { name, value } of configRows) {
      if (name in configSchema && typeof value !== "undefined") {
        this.set(name, value);
      }
    }
  }

  async preAction(command) {
    const { configSchema } = this;
    const { db } = this.parent;

    dotenv.config();
    this.config = Convict(configSchema);

    // Set config values from command line options
    // TODO: See if we can't reuse convict's built-in method for this?
    const opts = command.opts();
    if (opts.config) {
      const rows = [];
      for (const pair of opts.config) {
        const [name, value] = pair.split("=");
        rows.push({ name, value });
      }
      this.setAll(rows);
    }
  }

  async runConfigShow() {
    const { configSchema, config } = this;
    const log = this.log;

    const schema = configSchema;
    const props = config.getProperties();

    for (const [name, defn] of Object.entries(schema)) {
      const { doc, env, default: defaultValue } = defn;
      const currentValue = props[name];
      log.info({ configName: name, env, doc, defaultValue, currentValue });
    }
  }

  async runConfigSet(configName, configValue) {
    const { parent } = this;
    const { db } = parent;
    const log = this.log;

    const result = await db.setConfig({ [configName]: configValue });
    log.info({
      msg: "Reset config in database",
      configName,
      configValue,
      result,
    });
  }

  async runConfigReset(configName) {
    const { parent } = this;
    const { db } = parent;
    const log = this.log;

    const result = await db.resetConfig(configName);
    log.info({
      msg: "Reset config in database",
      configName,
    });
  }

  async runConfigGet(configName) {
    const { parent } = this;
    const { db } = parent;
    const log = this.log;

    const configValue = await db.getConfig(configName);
    log.info({
      msg: "Config from database",
      configName,
      configValue,
    });
  }
}
