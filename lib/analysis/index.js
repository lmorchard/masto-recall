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
    purgeStatusesPeriod: {
      doc: "Minimum period (in ms) to wait between purging old statuses",
      env: "PURGE_STATUSES_PERIOD",
      format: Number,
      default: 1000 * 60,
    },
  };

  constructor(parent) {
    super(parent);

    this.purgeOldDataEventHandle = null;
    this.purgeOldDataLastTime = Date.now();

    this.links = new AnalysisLinksPlugin(parent);
  }

  async init() {
    await this.links.init();

    const { db, events } = this.parent;
    const { EVENT_AFTER_COMMIT_SUCCESS } = db.writeQueue.constructor;
    this.purgeOldDataEventHandle = events.on(
      EVENT_AFTER_COMMIT_SUCCESS,
      this.purgeOldData.bind(this)
    );
  }

  async deinit() {
    const { db, events } = this.parent;
    const { EVENT_AFTER_COMMIT_SUCCESS } = db.writeQueue.constructor;
    if (this.purgeOldDataEventHandle) {
      events.off(EVENT_AFTER_COMMIT_SUCCESS, this.purgeOldDataEventHandle);
    }
  }

  async ingestStatusFromPayload(payload) {
    const { db, analysis, events } = this.parent;
    const log = this.log;

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

    const minPeriod = config.get("purgeStatusesPeriod");
    const sinceLastPeriod = Date.now() - this.purgeOldDataLastTime;
    if (sinceLastPeriod < minPeriod) {
      return;
    }
    this.purgeOldDataLastTime = Date.now();

    const hours = config.get("purgeStatusesMaxAge");
    const timeRange = `-${hours} hours`;

    await db.connection.raw(
      `delete from statuses where datetime(publishedAt) < datetime("now", ?)`,
      [timeRange]
    );
    await db.connection.raw(
      `delete from links where datetime(created_at) < datetime("now", ?)`,
      [timeRange]
    );

    log.info({
      msg: "purgeOldData",
      duration: Date.now() - this.purgeOldDataLastTime,
    });
  }
}
