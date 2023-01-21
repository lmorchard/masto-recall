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
  }

  async preAction(command) {
    const { config } = this.parent.config;
    const { prettyLogs } = command.opts();

    if (process.stdout.isTTY && prettyLogs) {
      this.transport = {
        target: "pino-pretty",
        options: { colorize: true },
      };
    }

    this.logOptions = {
      level: config.get("logLevel"),
      transport: this.transport,
    };

    this.rootlog = pino(this.logOptions);
  }

  log(bindings = {}, options) {
    return this.rootlog.child(bindings, options);
  }
}
