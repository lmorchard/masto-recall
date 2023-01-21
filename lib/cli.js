import fs from "fs/promises";
import { Command } from "commander";

import BasePlugin from "./base.js";

export default class CommandLineInterfacePlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    this.program = new Command();
  }

  async init() {
    const packageJsonFn = new URL("../package.json", import.meta.url);
    const packageJsonData = await fs.readFile(packageJsonFn);
    const packageJson = JSON.parse(packageJsonData);
    this.program.version(packageJson.version);
  }

  async run(argv = process.argv) {
    await this.program.parseAsync(argv);
  }
}
