import pino from "pino";

import BasePlugin from "./base.js";

export default class LoggingPlugin extends BasePlugin {
  static configSchema = {
    logLevel: {
      doc: "Logging level",
      env: "LOG_LEVEL",
      format: ["trace", "debug", "info", "warn", "error"],
      default: "info",
    },
  };

  constructor(parent) {
    super(parent);

    this.logOptions = {};

    const { program } = this.parent.cli;
    program.option(
      "--no-pretty-logs",
      "disable pretty printing of logs in a TTY"
    );
    program.option(
      "-C, --force-pretty-logs",
      "enable pretty printing of logs"
    );
  }

  async preAction(command) {
    const { config } = this.parent.config;
    const { prettyLogs, forcePrettyLogs } = command.opts();

    if (forcePrettyLogs || process.stdout.isTTY && prettyLogs) {
      this.transport = {
        target: "pino-pretty",
        options: {
          colorize: true,
          singleLine: true
        },
      };
    }

    this.logOptions = {
      level: config.get("logLevel"),
      transport: this.transport,
    };
  }

  get log() {
    if (!this._log) {
      this._log = pino(this.logOptions);
    }
    return this._log;
  }
}
