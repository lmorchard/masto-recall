import BasePlugin from "../base.js";

import AnalysisLinksPlugin from "./links.js";

export default class AnalysisPlugin extends BasePlugin {
  static configSchema = {
    purgeStatusesMaxAge: {
      doc: "Max age (in hours) for ingested statuses",
      env: "PURGE_STATUSES_MAX_AGE",
      format: Number,
      default: 120,
    },
  };

  constructor(parent) {
    super(parent);

    this.beforeCommitEventHandle = null;

    this.links = new AnalysisLinksPlugin(parent);
  }

  async init() {
    await this.links.init();
  }

  async deinit() {
    const { db, events } = this.parent;
    const { EVENT_BEFORE_COMMIT } = db.writeQueue.constructor;
    if (this.beforeCommitEventHandle) {
      events.off(EVENT_BEFORE_COMMIT, this.beforeCommitEventHandle);
    }
  }

  async ingestStatusFromPayload(payload) {
    const { db, analysis, events } = this.parent;
    const log = this.log;

    if (!this.beforeCommitEventHandle) {
      // HACK: on first call to this ingest function, set up an event listener
      // to purge old data before writeQueue commit
      const { EVENT_BEFORE_COMMIT } = db.writeQueue.constructor;
      this.beforeCommitEventHandle = events.on(
        EVENT_BEFORE_COMMIT,
        this.purgeOldData.bind(this)
      );
    }

    const { id, url, content, account, visibility } = payload;
    if (visibility !== "public") return;

    const { acct, bot } = account || {};
    log.trace({ msg: "ingestStatusFromPayload", id, acct, url, content });

    await db.putStatusFromPayload(payload);

    try {
      // Skip link extraction for bot accounts.
      if (!bot) {
        const links = await analysis.links.extractLinksFromPayload(payload);
        for (const link of links) {
          log.trace({ msg: "link", ...link });
          await db.putLink(link);
        }
      }
    } catch (error) {
      log.error({ msg: "linkExtractionFailed", error });
      console.log(error);
    }
  }

  async purgeOldData() {
    const { db, config } = this.parent;
    const log = this.log;
    const hours = config.get("purgeStatusesMaxAge");
    const timeRange = `-${hours} hours`;

    log.trace({ msg: "purgeOldData" });

    await db.writeQueue.enqueue("purgeOldStatuses", {}, (trx) => {
      trx.raw(
        `delete from statuses where datetime(publishedAt) < datetime("now", ?)`,
        [timeRange]
      );
    });

    await db.writeQueue.enqueue("purgeOldLinks", {}, (trx) => {
      trx.raw(
        `delete from links where datetime(created_at) < datetime("now", ?)`,
        [timeRange]
      );
    });
  }
}
