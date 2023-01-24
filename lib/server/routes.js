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
    const { q: query, limit = 30, offset = 0 } = request.query;
    const startTime = Date.now();

    let count = 0;
    let results = [];
    let pages = [];
    let pagePrevious = null;
    let pageNext = null;

    if (query) {
      ({ count, results } = await db.searchStatuses(query, { limit, offset }));
      const pageCount = count / limit;
      for (let page = 0; page <= pageCount; page++) {
        const pageOffset = limit * page;
        pages[page] = {
          limit,
          offset: pageOffset,
          pageNumber: page + 1,
        };
      }
      const currentPage = offset / limit;
      pages[currentPage].current = true;
      if (currentPage > 0) {
        pagePrevious = pages[currentPage - 1];
      }
      if (currentPage < pageCount) {
        pageNext = pages[currentPage + 1];
      }
    }

    const template = await templates.getTemplate("index");
    const body = template({
      search: {
        limit,
        offset,
        query,
        results,
        count,
        pages,
        pagePrevious,
        pageNext,
        showPagination: pages.length > 1,
      },
      meta: await this.buildPageMeta({ startTime, request }),
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
