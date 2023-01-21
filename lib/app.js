import EventsPlugin from "./events.js";
import CommandLineInterfacePlugin from "./cli.js";
import ConfigPlugin from "./config.js";
import LoggingPlugin from "./logging.js";
import ServerPlugin from "./server/index.js";
import DatabasePlugin from "./database/index.js";
import ClientPlugin from "./client.js";
import OAuthPlugin from "./oauth.js";
import StreamingPlugin from "./streaming.js";

export default class App {
  constructor() {
    /** @constant */
    this.plugins = [
      (this.events = new EventsPlugin(this)),
      (this.cli = new CommandLineInterfacePlugin(this)),
      (this.config = new ConfigPlugin(this)),
      (this.logging = new LoggingPlugin(this)),
      (this.db = new DatabasePlugin(this)),
      (this.client = new ClientPlugin(this)),
      (this.oauth = new OAuthPlugin(this)),
      (this.streaming = new StreamingPlugin(this)),
      (this.server = new ServerPlugin(this)),
    ];
  }

  async init() {
    for (const plugin of this.plugins) {
      await plugin.init();
    }
    return this;
  }

  async postError(error) {
    for (const plugin of this.plugins) {
      await plugin.postError(error);
    }
    return this;
  }

  async deinit() {
    for (const plugin of this.plugins) {
      await plugin.deinit();
    }
    return this;
  }

  async run() {
    try {
      await this.init();
      await this.cli.run(process.argv);
    } catch (error) {
      await this.postError(error);
      this.logging.log.error(error);
    }
    await this.deinit();
  }
}
