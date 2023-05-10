export default class BasePlugin {
  static configSchema = {};

  /** @param {import("./app.js").default} parent */
  constructor(parent) {
    this.parent = parent;

    const { config, cli } = parent;
    if (config) config.extendSchema(this.constructor.configSchema);
    if (cli) {
      cli.program.hook("preAction", this.preAction.bind(this));
      cli.program.hook("postAction", this.postAction.bind(this));
    }
  }

  async init() {}

  async deinit() {}

  async preAction() {}

  async postAction() {}

  async postError(error) {}

  get log() {
    return this.parent.logging.log.child({
      module: this.constructor.name,
    });
  }
}
