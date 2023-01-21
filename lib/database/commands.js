import fs from "fs/promises";
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

      const tableActivities = this.connection("activities");
      for (idx = 0; idx < count; idx++) {
        const activity = activities[idx];
        const { id, url, type, published, content } = activity;
        await tableActivities
          .insert({
            json: JSON.stringify(activity),
          })
          .onConflict("id")
          .merge();
      }

      clearInterval(progressInterval);
    }
  }

}