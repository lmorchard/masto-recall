import stream from "stream";

import pino from "pino";
import pretty from "pino-pretty";

import BasePlugin from "./base.js";

export default class LoggingPlugin extends BasePlugin {
  static EVENT_LOG = Symbol("eventLog");

  static configSchema = {
    logLevel: {
      doc: "Logging level",
      env: "LOG_LEVEL",
      format: ["trace", "debug", "info", "warn", "error"],
      default: "info",
    },
    logSingleLine: {
      doc: "Emit single-line log messages",
      env: "LOG_SINGLE_LINE",
      format: Boolean,
      default: true,
    },
  };

  constructor(parent) {
    super(parent);

    this.usePrettyLogs = false;

    const { program } = this.parent.cli;
    program.option(
      "--no-pretty-logs",
      "disable pretty printing of logs in a TTY"
    );
    program.option("-C, --force-pretty-logs", "enable pretty printing of logs");
  }

  async preAction(command) {
    const { prettyLogs, forcePrettyLogs } = command.opts();
    this.usePrettyLogs =
      forcePrettyLogs || (process.stdout.isTTY && prettyLogs);
  }

  /**
   * Clear the cached logger.
   *
   * Mainly used after updating configuration, because options will have changed.
   */
  reset() {
    this._log = undefined;
  }

  get log() {
    const { events, config } = this.parent;
    const { usePrettyLogs } = this;

    if (!this._log) {
      const logStreams = [
        {
          stream: usePrettyLogs
            ? pretty({
                colorize: true,
                singleLine: config.get("logSingleLine"),
              })
            : process.stdout,
        },
        {
          stream: new LogEventStream(events, this.constructor.EVENT_LOG),
        },
      ];
      const logOptions = {
        level: config.get("logLevel"),
      };
      this._log = pino(logOptions, pino.multistream(logStreams));
    }

    return this._log;
  }
}

class LogEventStream extends stream.Writable {
  constructor(events, eventName) {
    super();
    this.events = events;
    this.eventName = eventName;
  }
  _write(chunk, enc, next) {
    try {
      this.events.emit(this.eventName, JSON.parse(chunk.toString()));
    } catch {
      /* no-op */
    }
    next();
  }
}
