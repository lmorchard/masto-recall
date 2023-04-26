import BasePlugin from "../base.js";

import AnalysisLinksPlugin from "./links.js";

export default class AnalysisPlugin extends BasePlugin {
    static configSchema = {

    };

    constructor(parent) {
      super(parent);
      this.links = new AnalysisLinksPlugin(parent);
    }

    async init() {
      await this.links.init();
    }
}