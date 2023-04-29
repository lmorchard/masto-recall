import URL from "url";
import WebSocket from "ws";
import BasePlugin from "./base.js";

export default class StreamingPlugin extends BasePlugin {
  static configSchema = {
    streamTopic: {
      doc: "topic to be used for indexing",
      env: "STREAM_TOPIC",
      format: String,
      default: "user",
    },
    autoFollowBack: {
      doc: "automatically follow back",
      env: "AUTO_FOLLOW_BACK",
      format: Boolean,
      default: false,
    },
    indexRetoots: {
      doc: "index retoots from followed",
      env: "INDEX_REBLOGS",
      format: String,
      default: false,
    },
    streamStatsInterval: {
      doc: "interval in ms at which to report stream stats",
      env: "STREAM_STATS_INTERVAL",
      format: Number,
      default: 1000 * 5,
    },
    streamReconnectInterval: {
      doc: "interval in ms at which to reconnect the websocket",
      env: "STREAM_RECONNECT_INTERVAL",
      format: Number,
      default: 1000 * 60 * 15,
    },
    streamReconnectDelay: {
      doc: "delay in ms after which to attempt a reconnect",
      env: "STREAM_RECONNECT_DELAY",
      format: Number,
      default: 1000 * 10,
    },
    streamingApiUrl: {
      doc: "streaming API url (derived from API base URL by default)",
      env: "STREAMING_API_URL",
      format: String,
      default: null,
    },
    streamingDuplicateMaxAge: {
      doc: "interval during which to watch for duplicate notification IDs to ignore",
      env: "STREAMING_DUPLICATE_MAX_AGE",
      format: Number,
      default: 1000 * 1,
    },
  };

  constructor(parent) {
    super(parent);
    const { program } = parent.cli;
    program
      .command("streaming")
      .description("connect to streaming websocket API")
      .action(this.runStreaming.bind(this));
  }

  getStreamingApiUrl() {
    const { parent } = this;
    const { config } = parent;

    const existingWsBaseUrl = config.get("streamingApiUrl");
    if (existingWsBaseUrl) return existingWsBaseUrl;

    const baseURL = config.get("apiBaseUrl");
    const wsBaseURL = baseURL.replace("http", "ws");
    return `${wsBaseURL}/api/v1/streaming`;
  }

  async runStreaming() {
    const { parent } = this;
    const { config } = parent;

    this.connectStreaming();

    // HACK: the stream seems to just silently die after awhile, so periodically reconnect.
    // TODO: better investigate why the stream dies (are we missing an error or other event?)
    if (this._reconnectInterval) {
      clearInterval(this._reconnectInterval);
    }
    this._reconnectInterval = setInterval(
      () => this.reconnectStreaming(),
      config.get("streamReconnectInterval")
    );

    return new Promise((resolve, reject) => {
      // TODO: commenting these out to implement a never-exiting reconnecting stream seems hacky
      // ws.on("close", resolve);
      // ws.on("error", reject);
    });
  }

  setupStats() {
    const { config } = this.parent;
    this.stats = {
      connectStart: Date.now(),
      eventCounts: {},
    };
    if (this._statsInterval) {
      clearInterval(this._statsInterval);
    }
    this._statsInterval = setInterval(
      () => this.updateStats(),
      config.get("streamStatsInterval")
    );
  }

  updateStats() {
    const { stats } = this;
    const connectUptime = Date.now() - stats.connectStart;
    const totalEvents = Object.values(stats.eventCounts).reduce(
      (acc, curr) => acc + curr,
      0
    );
    const eventsPerMinute = totalEvents / (connectUptime / (1000 * 60));

    this.log.info({
      msg: "stats",
      ...stats,
      connectUptime,
      eventsPerMinute,
    });
  }

  async connectStreaming() {
    const { parent } = this;
    const { config } = parent;
    const { log } = this;

    this.setupStats();

    const streamingApiUrl = this.getStreamingApiUrl();
    log.info({ msg: "connect", streamingApiUrl });

    const params = new URL.URLSearchParams({
      access_token: config.get("accessToken"),
      stream: config.get("streamTopic"),
    });
    const streamingApiUrlWithParams = `${streamingApiUrl}?${params.toString()}`;

    const ws = (this.ws = new WebSocket(streamingApiUrlWithParams, {
      followRedirects: true,
      headers: {
        "User-Agent": config.get("userAgent"),
      },
    }));
    ws.on("open", this.handleStreamingOpen.bind(this));
    ws.on("message", this.handleStreamingMessage.bind(this));
    ws.on("close", this.handleStreamingClose.bind(this));
    ws.on("error", this.handleStreamingError.bind(this));
  }

  async disconnectStreaming() {
    const log = this.log;

    if (!this.ws) return;

    log.info({ msg: "disconnect" });

    this._disconnecting = true;
    this.ws.removeAllListeners();
    this.ws.close();
    this.ws = null;
    this._disconnecting = false;
  }

  async reconnectStreaming() {
    const log = this.log;
    if (this._reconnectTimer) return;

    log.info({ msg: "reconnect" });

    this._reconnectTimer = setTimeout(() => {
      this.disconnectStreaming();
      this.connectStreaming();
      this._reconnectTimer = null;
    }, this.parent.config.get("streamReconnectDelay"));
  }

  async handleStreamingOpen() {
    this.log.trace({ msg: "open" });
    // parent.onStart();
  }

  async handleStreamingClose() {
    if (this._disconnecting) return;
    this.log.info({ msg: "closed" });
    this.reconnectStreaming();
  }

  async handleStreamingError(err) {
    this.log.info({ msg: "error", err });
    this.reconnectStreaming();
  }

  async handleStreamingMessage(dataBuf) {
    try {
      const log = this.log;
      const json = dataBuf.toString();
      const { stream, event, payload: payloadRaw } = JSON.parse(json);
      log.trace({ msg: "received", stream, event, payload: payloadRaw });

      if (event in this.stats.eventCounts) {
        this.stats.eventCounts[event]++;
      } else {
        this.stats.eventCounts[event] = 0;
      }

      switch (event) {
        case "notification":
          return this.handleNotification(payloadRaw);
        case "status.update":
        case "update":
          return this.handleStatusUpdate(payloadRaw, event);
        case "delete":
          return this.handleStatusDelete(payloadRaw);
        default:
          log.debug({
            msg: "unhandled",
            event,
            payload: payloadRaw,
          });
          break;
      }
    } catch (err) {
      log.error({ msg: "received", err });
    }
  }

  async handleStatusUpdate(payloadRaw, event) {
    const { db, analysis } = this.parent;
    const log = this.log;

    const payload = JSON.parse(payloadRaw);
    const { id, url, content, account, visibility } = payload;

    const { acct, bot } = account;
    if (visibility !== "public") return;

    log.debug({ msg: "statusUpdate", event, id });
    log.trace({ msg: "statusUpdate", event, id, acct, url, content });

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
    }
  }

  async handleStatusDelete(id) {
    const { db } = this.parent;
    const log = this.log;
    await db.deleteStatus(id);
    log.debug({ msg: "statusDelete", id });
  }

  async handleNotification(payloadRaw) {
    const payload = JSON.parse(payloadRaw);
    switch (payload.type) {
      case "follow": {
        return this.handleFollow(payload);
      }
    }
  }

  async handleFollow(payload) {
    const { config, client } = this.parent;
    const { authedClient } = client;
    const log = this.log;

    const { account } = payload;
    const { acct, id } = account;

    if (config.get("autoFollowBack")) {
      const resp = await authedClient({
        method: "POST",
        url: `/api/v1/accounts/${id}/follow`,
        params: {
          reblogs: config.get("indexRetoots"),
        },
      });
      log.info({ msg: "followed", acct, resp: resp.data });
    }
  }
}
