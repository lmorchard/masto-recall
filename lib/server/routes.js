import BasePlugin from "../base.js";

export default class ServerRoutesPlugin extends BasePlugin {
  async extendServer(server) {
    server.get("/", this.getIndex.bind(this));
    server.get("/top-links", this.getTopLinks.bind(this));
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

  async getTopLinks(request, reply) {
    const { db, config, templates } = this.parent;
    const { limit = 25, hours = 12 } = request.query;
    const startTime = Date.now();

    const dbParams = {
      limit: parseInt(limit, 10),
      hours: parseInt(hours, 10),
    };
    const [links, statuses] = await Promise.all([
      db.fetchTopRecentLinks(dbParams),
      db.fetchStatusesForTopRecentLinks(dbParams),
    ]);

    const statusesByNormalized = {};
    for (const row of statuses) {
      const normalized = row.normalized;
      const { json, ...rest } = row;
      const status = { ...rest, ...JSON.parse(json) };

      if (!statusesByNormalized[normalized]) {
        statusesByNormalized[normalized] = [];
      }
      statusesByNormalized[normalized].push(status);
    }

    const template = await templates.getTemplate("topLinks");
    const body = template({
      query: {
        limit,
        hours,
      },
      links,
      statusesByNormalized,
      meta: {
        apiBaseUrl: config.get("apiBaseUrl"),
        botName: config.get("botName"),
        duration: Date.now() - startTime,
      },
    });

    return reply
      .code(200)
      .headers({
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*",
      })
      .send(body);
  }

  async getIndex(request, reply) {
    const { log } = this;
    const { db, templates } = this.parent;
    const { q: query, limit = 15, offset = 0 } = request.query;
    const startTime = Date.now();

    let error = null;
    let count = 0;
    let results = [];
    let resultsSql = "";
    let pages = [];
    let pagePrevious = null;
    let pageNext = null;

    try {
      const queryPresent = query && query != "";
      const queryOptions = {
        limit,
        offset,
      };
      if (queryPresent) {
        ({ count, results, resultsSql } = await db.searchStatuses_fts(
          query,
          queryOptions
        ));
      } else {
        ({ count, results, resultsSql } = await db.recentStatuses(
          queryOptions
        ));
      }
    } catch (queryError) {
      count = 0;
      results = [];
      error = queryError;
      log.error({ msg: "queryError", error });
    }

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

    const template = await templates.getTemplate("index");
    const body = template({
      error,
      search: {
        limit,
        offset,
        query,
        results,
        resultsSql,
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
