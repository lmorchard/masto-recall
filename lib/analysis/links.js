import fs from "fs/promises";

import * as Cheerio from "cheerio";
import { tall } from "tall";
import axios from "axios";
import normalizeUrl from "normalize-url";

import BasePlugin from "../base.js";

const QUERY_PARAM_BLACKLIST = [
  /utm_.*/,
  /CMP/,
  /mc_eid/,
  /oly_.*/,
  /__s/,
  /vero_id/,
  /_hsenc/,
  /mkt_tok/,
  /fbclid/,
  /etsrc/,
  /share_time/,
  /smid/,
  /smtyp/,
];

export default class AnalysisLinksPlugin extends BasePlugin {
  static configSchema = {
    linksUnshortenTimeout: {
      doc: "Path to the sqlite database",
      env: "LINKS_UNSHORTEN_TIMEOUT",
      format: Number,
      default: 1000,
    },
  };

  constructor(parent) {
    super(parent);

    this.queryParamBlacklist = QUERY_PARAM_BLACKLIST;

    const { program } = this.parent.cli;

    program
      .command("extractlinks")
      .description("extract links from recent statuses")
      .action(this.runExtractLinks.bind(this));
  }

  async init() {
    await this.getUrlShortenersList();
  }

  async runExtractLinks() {
    const { log } = this;
    const { db, analysis } = this.parent;

    const { count, results } = await db.recentStatuses({ limit: 100 });

    for (let row of results) {
      const { id, content } = row;
      const links = await analysis.links.extractLinksFromPayload(row);
      for (const link of links) {
        log.trace({ msg: "link", ...link });
        await db.putLink(link);
      }
    }

    await db.commitWrites();
  }

  async getUrlShortenersList() {
    if (!this.urlShorteners) {
      const urlShortenersFn = new URL("url-shorteners.txt", import.meta.url);
      const urlShortenersData = await fs.readFile(urlShortenersFn);
      this.urlShorteners = urlShortenersData
        .toString("utf8")
        .split(/[\r?\n]/)
        .filter((line) => !!line && !line.startsWith("#"));
    }
    return this.urlShorteners;
  }

  async extractLinksFromPayload(status) {
    const { content, id: statusId } = status;
    const $ = Cheerio.load(content);

    const links = $("a")
      .filter((i, el) => {
        const className = $(el).attr("class");
        if (className && className.includes("mention hashtag")) {
          return false;
        }
        return true;
      })
      .map((i, el) => {
        const href = $(el).attr("href");
        return { statusId, href };
      });

    for (const link of links) {
      link.normalized = link.href;
      await this.dereferenceShortLink(link);
      await this.normalizeLink(link);
    }

    return links;
  }

  async normalizeLink(link) {
    const { normalized } = link;

    const normalizedURL = new URL(
      normalizeUrl(normalized, {
        defaultProtocol: "https",
        normalizeProtocol: true,
        stripAuthentication: true,
        // stripHash: true,
        // stripTextFragment: true,
        stripWWW: true,
        sortQueryParameters: true,
        removeTrailingSlash: true,
        removeExplicitPort: true,
      })
    );

    const paramsToDelete = [];
    for (const [key, value] of normalizedURL.searchParams.entries()) {
      for (const pattern of this.queryParamBlacklist) {
        if (pattern.test(key)) {
          paramsToDelete.push(key);
        }
      }
    }
    for (const key of paramsToDelete) {
      normalizedURL.searchParams.delete(key);
      link.paramsStripped = true;
    }

    link.normalized = normalizedURL.toString();
  }

  async dereferenceShortLink(link) {
    const { config } = this.parent;
    const { normalized } = link;

    const urlShorteners = await this.getUrlShortenersList();
    const url = new URL(normalized);
    if (!urlShorteners.includes(url.hostname)) return;

    link.shortened = true;

    try {
      link.normalized = await tall(normalized, {
        timeout: config.get("linksUnshortenTimeout"),
      });
      link.unshortened = true;
    } catch {
      link.unshortenFailed = true;
    }
  }
}
