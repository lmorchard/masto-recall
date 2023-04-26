import BasePlugin from "../base.js";

export default class DatabaseKnexPlugin extends BasePlugin {
  static configSchema = {
    databaseMigrationsPath: {
      doc: "Path to the directory containing Knex database migrations",
      env: "DATABASE_MIGRATIONS_PATH",
      format: String,
      default: "./lib/database/migrations",
    },
    databaseSeedsPath: {
      doc: "Path to the directory containing Knex database seeds",
      env: "DATABASE_SEEDS_PATH",
      format: String,
      default: "./lib/database/seeds",
    },
  };

  constructor(parent) {
    super(parent);

    const { program } = this.parent.cli;

    const databaseProgram = program
      .command("knex")
      .description("knex database maintenance operations");

    const migrateProgram = databaseProgram
      .command("migrate")
      .description("database migration operations");

    migrateProgram
      .command("make <name>")
      .description("create a new migration")
      .action((name) => this.runMigratorCommand("make", name));

    migrateProgram
      .command("latest")
      .description("run all migrations")
      .action(() => this.runMigratorCommand("latest"));

    migrateProgram
      .command("up")
      .description("run the next migration")
      .action(() => this.runMigratorCommand("up"));

    migrateProgram
      .command("down")
      .description("undo the last migration")
      .action(() => this.runMigratorCommand("down"));

    migrateProgram
      .command("currentVersion")
      .description("show the latest migration version")
      .action(() => this.runMigratorCommand("currentVersion"));

    migrateProgram
      .command("list")
      .description("list applied migrations")
      .action(() => this.runMigratorCommand("list"));

    migrateProgram
      .command("unlock")
      .description("unlock migrations")
      .action(() => this.runMigratorCommand("unlock"));

    const seedProgram = databaseProgram
      .command("seed")
      .description("database seed operations");

    seedProgram
      .command("make <name>")
      .description("make a new seed file")
      .action((name) => this.runSeederCommand("make", name));

    seedProgram
      .command("run")
      .description("run all seed files")
      .action((name) => this.runSeederCommand("run", name));
  }

  async runInit() {
    const { db } = this.parent;
    await db.connection.migrate.latest(this.migratorConfig);
    await db.connection.seed.run(this.seederConfig);
  }

  async preAction() {
    const { config } = this.parent;

    this.migratorConfig = {
      directory: config.get("databaseMigrationsPath"),
      extension: "cjs",
    };

    this.seederConfig = {
      directory: config.get("databaseSeedsPath"),
      extension: "cjs",
    };
  }

  async runMigratorCommand(name, ...args) {
    const { db } = this.parent;
    const result = await db.connection.migrate[name](
      ...args,
      this.migratorConfig
    );
    this.log.info({ msg: name, result });
  }

  async runSeederCommand(name, ...args) {
    const { db } = this.parent;
    const result = await db.connection.seed[name](...args, this.seederConfig);
    this.log.info({ msg: name, result });
  }
}
