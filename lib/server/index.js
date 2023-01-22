import path from "path";
import { URL } from "url";

import Fastify from "fastify";
import FastifyStatic from "@fastify/static";
import FastifyAccepts from "@fastify/accepts";
import FastifyCompress from "@fastify/compress";
import Boom from "@hapi/boom";

import BasePlugin from "../base.js";

import ServerRoutesPlugin from "./routes.js";

export default class ServerPlugin extends BasePlugin {
  static configSchema = {
    host: {
      doc: "Server host",
      env: "HOST",
      format: String,
      default: "localhost",
    },
    port: {
      doc: "Server port",
      env: "PORT",
      format: Number,
      default: 8089,
    },
    publicPath: {
      doc: "Public web static resources path",
      env: "PUBLIC_PATH",
      format: String,
      default: "public",
    },
    siteUrl: {
      doc: "Server base URL",
      env: "SITE_URL",
      nullable: true,
      default: null,
    },
    projectDomain: {
      doc: "Glitch.com project domain",
      env: "PROJECT_DOMAIN",
      nullable: true,
      default: null,
    },
    projectId: {
      doc: "Glitch.com project ID",
      env: "PROJECT_ID",
      nullable: true,
      default: null,
    },
  };

  constructor(parent) {
    super(parent);
    this.routes = new ServerRoutesPlugin(parent);

    const { program } = this.parent.cli;
    program.hook("preAction", this.preAction.bind(this));
    program
      .command("serve")
      .description("run the web server")
      .action(this.runServer.bind(this));
  }

  async init() {}

  async preAction() {
    this.setDefaultSiteUrl();
  }

  async runServer() {
    const { config } = this.parent;
    this.server = await this.buildServer();

    // Defer resolution of this method until the server closes, which
    // defers postAction cleanup like closing database connections
    const closePromise = new Promise((resolve, reject) => {
      this.server.addHook("onClose", (instance, done) => {
        resolve();
        done();
      });
    });

    await this.server.listen({
      host: config.get("host"),
      port: config.get("port"),
    });

    return closePromise;
  }

  async buildServer() {
    const { config } = this.parent;

    const server = Fastify({
      logger: this.parent.logging.logOptions,
    });

    server
      .register(FastifyCompress)
      .register(FastifyStatic, {
        root: path.resolve(config.get("publicPath")),
        prefix: "/",
      })
      .register(FastifyAccepts);

    await this.routes.extendServer(server);

    return server;
  }

  setDefaultSiteUrl() {
    const { log } = this;
    const { db, config } = this.parent;

    if (config.get("siteUrl")) return;

    const projectId = config.get("projectId");
    const projectDomain = config.get("projectDomain");
    if (projectDomain && projectId) {
      // HACK: Having PROJECT_DOMAIN and PROJECT_ID set are a good indication
      // to try auto-configuring the siteUrl for a Glitch project
      const siteUrl = `https://${projectDomain}.glitch.me`;
      log.trace({ msg: "Using Glitch site URL", siteUrl });
      return config.set("siteUrl", siteUrl);
    }

    const host = config.get("host");
    const port = config.get("port");
    const siteUrl = new URL(`http://${host}:${port}`).toString();
    log.trace({ msg: "Using default site URL", siteUrl });
    config.set("siteUrl", siteUrl);
  }
}
