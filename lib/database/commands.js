import fs from "fs/promises";
import { createReadStream } from "fs";

import axios from "axios";

import gunzip from "gunzip-maybe";
import tar from "tar-stream";

import BasePlugin from "../base.js";

export default class DatabaseCommandsPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    const { program } = this.parent.cli;

    program
      .command("importfile <filenames...>")
      .description("import data from an outbox JSON export")
      .action(this.runImportFile.bind(this));

    program
      .command("importmastodon <filenames...>")
      .description("import data from a Mastodon export tarball")
      .action(this.runImportMastodon.bind(this));

    program
      .command("importurl <url>")
      .description("import data from an outbox JSON URL")
      .option("-p, --pages <count>", "limit to number of pages fetched")
      .action(this.runImportUrl.bind(this));
  }

  async runImportFile(outboxFilenames) {
    const { log } = this;

    for (const outboxFilename of outboxFilenames) {
      log.info({ msg: "Importing", outboxFilename });
      const outboxData = await fs.readFile(outboxFilename);
      const outbox = JSON.parse(outboxData);
      await this.importOutbox(outbox);
    }
  }

  async runImportMastodon(filenames) {
    const { log } = this;

    for (const filename of filenames) {
      log.info({ msg: "Processing file", filename });
      const extract = tar.extract();

      const tgzStream = createReadStream(filename);
      tgzStream.pipe(gunzip()).pipe(extract);

      const outboxData = await new Promise((resolve, reject) => {
        extract.on("finish", () => resolve(null));
        extract.on("error", (error) => reject(error));
        extract.on("entry", (header, stream, next) => {
          const { name } = header;
          if (name !== "outbox.json") {
            log.trace({ msg: "Skipping entry", entryName: name });
            stream.on("end", () => next());
            stream.resume();
          } else {
            log.info({ msg: "Reading entry", entryName: name });
            const buffers = [];
            stream.on("data", (d) => buffers.push(d));
            stream.on("error", (error) => {
              tgzStream.destroy();
              reject(error);
            });
            stream.on("end", () => {
              tgzStream.destroy();
              resolve(Buffer.concat(buffers));
            });
          }
        });
      });

      const outbox = JSON.parse(outboxData);
      await this.importOutbox(outbox);
    }
  }

  async runImportUrl(outboxUrl, options) {
    const { log } = this;
    const { config } = this.parent;

    const maxPages = options.pages ? parseInt(options.pages) : null;
    let pageCount = 0;

    const response = await axios.get(outboxUrl, {
      headers: {
        "User-Agent": config.get("userAgent"),
        Accept: "application/activity+json",
      },
    });

    if (200 !== response.status) {
      log.error({
        msg: "failed to fetch first page",
        statusText: response.statusText,
        response,
      });
      return;
    }

    let nextPageUrl = response.data.first;
    if (!nextPageUrl) {
      log.error({
        msg: "outbox does't offer first page",
        statusText: response.statusText,
        response,
      });
    }

    while (nextPageUrl) {
      pageCount++;
      log.info({ msg: "fetching", pageCount, nextPageUrl });

      const response = await axios.get(nextPageUrl, {
        headers: {
          "User-Agent": config.get("userAgent"),
          Accept: "application/activity+json",
        },
      });

      if (200 !== response.status) {
        log.error({
          msg: "failed to fetch page",
          statusText: response.statusText,
          nextPageUrl,
          response,
        });
        break;
      }

      if (
        !response.data.orderedItems ||
        response.data.orderedItems.length === 0
      ) {
        log.info({ msg: "No more items to import" });
        break;
      }

      await this.importOutbox(response.data);

      nextPageUrl = response.data.next;
      if (!nextPageUrl) {
        log.info({ msg: "No more pages to import" });
      }

      if (maxPages !== null && pageCount >= maxPages) {
        log.info({ msg: "Max pages imported", pageCount, maxPages });
        break;
      }
    }
  }

  async importOutbox(outbox) {
    const { log } = this;
    const { db } = this.parent;

    db.enableAutoCommit = false;

    const activities = outbox.orderedItems;

    if (!Array.isArray(activities)) {
      log.error({ msg: "No items found in outbox" });
      return;
    }

    const startTime = Date.now();
    const count = outbox.orderedItems.length;
    log.info({ msg: "importOutbox", count });

    let idx = 0;
    const progressInterval = setInterval(() => {
      const progress = idx / count;
      const duration = Date.now() - startTime;
      const avgTime = duration / (idx + 1);

      log.info({
        msg: "progress",
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
      if (idx > 0 && idx % 100 == 0) {
        await db.writeQueue.commit();
      }
    }
    await db.writeQueue.commit();

    clearInterval(progressInterval);
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
        Accept: "application/activity+json",
      },
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
