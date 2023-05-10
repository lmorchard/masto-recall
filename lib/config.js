import * as dotenv from "dotenv";
import Convict from "convict";
import BasePlugin from "./base.js";

export default class ConfigPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);

    this.configSchema = {};

    const { program } = this.parent.cli;

    program.option(
      "-f, --config-file <path>",
      "load config from specified JSON file"
    );
    program.option("-F, --config <name=value...>", "set configuration values");

    const configProgram = program
      .command("config")
      .description("configuration operations");

    configProgram
      .command("show")
      .description("show current configuration")
      .action(this.runConfigShow.bind(this));

    configProgram
      .command("dump")
      .option("-d, --include-defaults", "include default values")
      .description("dump current configuration as JSON file")
      .action(this.runConfigDump.bind(this));

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

  has(name) {
    return this.config.has(name);
  }

  setAll(configRows, options = {}) {
    const { skipExisting } = options;
    for (const { name, value } of configRows) {
      if (!this.has(name)) continue;
      if (typeof value === "undefined") continue;
      if (skipExisting && this.config.default(name) !== value) continue;

      this.set(name, value);
    }
  }

  async preAction(command) {
    const { configSchema } = this;
    const { db, logging } = this.parent;
    const options = command.opts();

    const config = (this.config = Convict(configSchema));

    // Load config from environment, overrides everything below
    dotenv.config();

    // Load config from file, if specified
    if (options.configFile) {
      config.loadFile(options.configFile);
    }

    // Set config values from command line options
    // TODO: See if we can't reuse convict's built-in method for this?
    if (options.config) {
      const rows = [];
      for (const pair of options.config) {
        const [name, value] = pair.split("=");
        rows.push({ name, value });
      }
      this.setAll(rows);
    }

    // Finally, try loading config from database, but skip setting any
    // values already configured previously
    try {
      const dbConfig = await db.getAllConfig();
      this.setAll(dbConfig, { skipExisting: true });
    } catch (error) {
      // If `init` command hasn't been run yet, we won't have this table.
      if (!/no such table: config/.test(error.message)) {
        throw error;
      }
    }

    // Configuration has changed by this point, so clear cached logger
    logging.reset();
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

  async runConfigDump(options) {
    const { configSchema, config } = this;
    const { includeDefaults } = options;

    const schema = configSchema;
    const props = config.getProperties();

    if (!includeDefaults) {
      for (const [name, defn] of Object.entries(schema)) {
        const { default: defaultValue } = defn;
        const currentValue = props[name];
        if (currentValue === defaultValue) {
          delete props[name];
        }
      }
    }

    process.stdout.write(
      JSON.stringify(props, null, "  ")
    );
  }

  async runConfigSet(configName, configValue) {
    const { parent } = this;
    const { db } = parent;
    const log = this.log;

    const result = await db.setConfig({ [configName]: configValue });
    log.info({
      msg: "Set config in database",
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
