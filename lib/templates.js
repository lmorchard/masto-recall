import BasePlugin from "./base.js";

import fs from "fs/promises";
import path from "path";
import Handlebars from "handlebars";

export default class TemplatesPlugin extends BasePlugin {
  static configSchema = {
    templatesPath: {
      doc: "path where content templates can be found",
      env: "TEMPLATES_PATH",
      format: String,
      default: "./templates",
    },
    templatesTimeZone: {
      doc: "timezone used in date formatting",
      env: "TEMPLATES_TIMEZONE",
      format: String,
      default: "PST",
    }
  };

  constructor(parent) {
    super(parent);
    const { config } = this.parent;

    /** @type Record<string, HandlebarsTemplateDelegate<any>> */
    this._templates = {};

    /** @type Handlebars */
    const handlebars = (this.handlebars = Handlebars.create());

    handlebars.registerHelper("shortDateTime", this.helperShortDateTime.bind(this));
    handlebars.registerHelper("randomchoices", this.helperRandomChoices.bind(this));
    handlebars.registerHelper("choice", this.helperChoice.bind(this));
    handlebars.registerHelper('coalesce', (...args) => args.find(i => !!i));    
  }

  async preAction() {
    const { config } = this.parent;

    this.timeZone = config.get("templatesTimeZone");
    this.dateFormat = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timeZone,
      timeStyle: "short",
      dateStyle: "short",
    });

    const partialsPath = path.join(config.get("templatesPath"), "partials");
    const filenames = await fs.readdir(partialsPath);
    for (const filename of filenames) {
      if (filename.endsWith(".hbs")) {
        const name = path.basename(filename, ".hbs");
        const content = await fs.readFile(path.join(partialsPath, filename));
        this.handlebars.registerPartial(name, content.toString());
      }
    }
  }

  async getTemplate(name) {
    if (!this._templates[name]) {
      const { config } = this.parent;
      const templatePath = path.join(
        config.get("templatesPath"),
        `${name}.hbs`
      );
      const templateSource = await fs.readFile(templatePath);
      this._templates[name] = this.handlebars.compile(
        templateSource.toString()
      );
    }
    return this._templates[name];
  }

  async postTemplatedStatus({
    name,
    variables = {},
    options = { visibility: "public" },
  }) {
    const { parent } = this;
    const { client } = parent;
    const log = this.log;
    const template = await this.getTemplate(name);
    const status = template(variables);
    log.trace({ msg: "postTemplatedStatus", name, status, options });
    return client.postStatus({ status, ...options });
  }

  helperShortDateTime(dateString) {
    return `${this.dateFormat.format(new Date(dateString))} ${this.timeZone}`;
  }

  helperRandomChoices(options) {
    this._randomChoices = [];
    options.fn(this);
    const output =
      this._randomChoices[
        Math.floor(Math.random() * this._randomChoices.length)
      ];
    delete this._randomChoices;
    return output;
  }

  helperChoice(options) {
    if (!this._randomChoices) return;
    this._randomChoices.push(options.fn(this));
  }
}
