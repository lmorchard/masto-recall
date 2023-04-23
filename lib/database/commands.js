import fs from "fs/promises";
import axios from "axios";

import BasePlugin from "../base.js";

export default class DatabaseCommandsPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    const { program } = this.parent.cli;

    program
      .command("import <filenames...>")
      .description("import data from an outbox JSON export")
      .action(this.runImport.bind(this));
  }

  async runImport(outboxFilenames) {
    const { log } = this;
    const { db } = this.parent;

    db.enableAutoCommit = false;

    for (const outboxFilename of outboxFilenames) {
      log.info({ msg: "Importing", outboxFilename });

      const outboxData = await fs.readFile(outboxFilename);
      const outbox = JSON.parse(outboxData);
      const activities = outbox.orderedItems;

      if (!Array.isArray(activities)) {
        log.error({ msg: "No items found in outbox" });
        continue;
      }

      const startTime = Date.now();
      const count = outbox.orderedItems.length;
      log.info({
        msg: "Found activities in outbox",
        count,
      });

      let idx = 0;
      const progressInterval = setInterval(() => {
        const progress = idx / count;
        const duration = Date.now() - startTime;
        const avgTime = duration / (idx + 1);

        log.info({
          msg: "Import progress",
          outboxFilename,
          progress: Math.floor(progress * 1000) / 10,
          duration: Math.floor(duration / 1000),
          eta: Math.floor((avgTime * count) / 1000),
          avgTime: Math.floor(avgTime * 100) / 100,
          avgRate: Math.floor(1000 / avgTime),
        });
      }, 1000);

      for (idx = 0; idx < count; idx++) {
        const activity = activities[idx];
        const { id, actor: actorUrl } = activity;

        const actor = await this.fetchActor(actorUrl);
        if (actor) {
          activity.actor = actor;
        }
        
        await db.importActivity(activity);
        if (idx % 100 == 0) {
          await db.commitWrites();
        }
      }
      await db.commitWrites();

      clearInterval(progressInterval);
    }
  }

  async fetchActor(actorUrl) {
    const { log } = this;
    const { config } = this.parent;
    
    if (!this.actorsCache) { 
      this.actorsCache = new Map();
    }
    if (this.actorsCache.has(actorUrl)) {
      return this.actorsCache.get(actorUrl);
    }

    const response = await axios.get(actorUrl, {
      headers: {
        "User-Agent": config.get("userAgent"),
        "Accept": "application/activity+json",
      }
    });

    if (200 === response.status) {
      const actor = response.data;
      this.actorsCache.set(actorUrl, actor);
      log.debug({ msg: "fetchActor", actor });
      return actor;
    }
    
    return null;
  }
}