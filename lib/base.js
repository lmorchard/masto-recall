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

  async preAction() {}

  async postAction() {}

  get log() {
    if (!this._log) {
      this._log = this.parent.logging.log({
        module: this.constructor.name,
      });
    }
    return this._log;
  }
}
