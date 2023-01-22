import BasePlugin from "../base.js";

export default class ServerRoutesPlugin extends BasePlugin {
  async extendServer(server) {
    /*
      server
        .get("/.well-known/webfinger", getWebFinger)
        .get("/actors/:username/icon", getActorIcon)
        .get("/actors/:username", getActor)
        .post("/inbox", postSharedInbox)
        .post("/actors/:username/inbox", postActorInbox);
    */

    server.get("/", this.getIndex.bind(this));
  }

  async buildPageMeta({ startTime, request }) {
    const { db, config } = this.parent;
    const statistics = await db.getStatistics();
    return {
      apiBaseUrl: config.get("apiBaseUrl"),
      botName: config.get("botName"),
      ...statistics,
      duration: Date.now() - startTime,
    };
  }

  async getIndex(request, reply) {
    const { db, templates } = this.parent;
    const { q: searchQuery } = request.query;
    const startTime = Date.now();

    let searchResults = [];
    if (searchQuery) {
      searchResults = (await db.searchStatuses(searchQuery)).map((status) => ({
        ...status,
        ...JSON.parse(status.json),
      }));
    }

    const template = await templates.getTemplate("index");
    const body = template({
      meta: await this.buildPageMeta({ startTime, request }),
      searchQuery,
      searchResults,
    });

    return reply
      .code(200)
      .headers({
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*",
      })
      .send(body);
  }
}
