import fs from "fs/promises";
import { Command } from "commander";

import BasePlugin from "./base.js";

export default class CommandLineInterfacePlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    
    const program = (this.program = new Command());

    program
      .command("init")
      .description("initialize the database")
      .action(this.runInit.bind(this));

    program
      .command("upgrade")
      .description("perform data upgrades after a code update")
      .action(this.runUpgrade.bind(this));

    program
      .command("start")
      .description("run the web server and streaming bot together")
      .action(this.runStart.bind(this));
  }

  async init() {
    const { program } = this;

    const packageJsonFn = new URL("../package.json", import.meta.url);
    const packageJsonData = await fs.readFile(packageJsonFn);
    const packageJson = JSON.parse(packageJsonData);

    program.version(packageJson.version);
  }

  async run(argv = process.argv) {
    await this.program.parseAsync(argv);
  }

  async runInit() {
    const { db } = this.parent;
    await db.knex.runInit();
  }

  async runUpgrade() {
    const { db } = this.parent;
    await db.knex.runMigratorCommand("latest");
  }

  async runStart() {
    const { streaming, server } = this.parent;
    return await Promise.all([
      streaming.runStreaming(),
      server.runServer(),
    ]);
  }
}
