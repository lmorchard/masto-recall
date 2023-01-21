import EventsPlugin from "./events.js";
import CommandLineInterfacePlugin from "./cli.js";
import ConfigPlugin from "./config.js";
import LoggingPlugin from "./logging.js";
import ServerPlugin from "./server/index.js";
import DatabasePlugin from "./database/index.js";

export default class App {
  constructor() {
    this.events = new EventsPlugin(this);
    this.cli = new CommandLineInterfacePlugin(this);
    this.config = new ConfigPlugin(this);
    this.logging = new LoggingPlugin(this);
    this.db = new DatabasePlugin(this);
    this.server = new ServerPlugin(this);
  }

  async init() {    
    await this.events.init();
    await this.cli.init();
    await this.config.init();
    await this.logging.init();
    await this.db.init();
    await this.server.init();
    return this;
  }

  async run() {
    await this.init();
    await this.cli.run(process.argv);
  }
}
