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
      default: true,
    },
    indexRetoots: {
      doc: "index retoots from followed",
      env: "INDEX_REBLOGS",
      format: String,
      default: false,
    },
    streamReconnectInterval: {
      doc: "interval in ms at which to reconnect the websocket",
      env: "STREAM_RECONNECT_INTERVAL",
      format: Number,
      default: 1000 * 60 * 30,
    },
    streamReconnectDelay: {
      doc: "delay in ms after which to attempt a reconnect",
      env: "STREAM_RECONNECT_DELAY",
      format: Number,
      default: 1000 * 5,
    },
    streamingApiUrl: {
      doc: "streaming API url (derived from API base URL by default)",
      env: "STREAMING_API_URL",
      format: String,
      default: null,
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

  async preAction() {
    this.setDefaultStreamingApiUrl();
  }

  setDefaultStreamingApiUrl() {
    const { parent } = this;
    const { config } = parent;

    if (config.get("streamingApiUrl")) return;

    const baseURL = config.get("apiBaseUrl");
    const wsBaseURL = baseURL.replace("http", "ws");
    return config.set("streamingApiUrl", `${wsBaseURL}/api/v1/streaming`);
  }

  async runStreaming() {
    const { parent } = this;
    const { config } = parent;

    this.connectStreaming();

    // HACK: the stream seems to just silently die after awhile, so periodically reconnect.
    // TODO: better investigate why the stream dies (are we missing an error or other event?)
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

  async connectStreaming() {
    const { parent } = this;
    const { config } = parent;
    const log = this.log;

    const streamingApiUrl = config.get("streamingApiUrl");
    log.info({ msg: "Connecting to websocket", streamingApiUrl });

    const params = new URL.URLSearchParams({
      access_token: config.get("accessToken"),
      stream: config.get("streamTopic"),
    });

    const ws = (this.ws = new WebSocket(
      `${streamingApiUrl}?${params.toString()}`,
      {
        followRedirects: true,
        headers: {
          "User-Agent": config.get("userAgent"),
        },
      }
    ));
    ws.on("open", this.handleStreamingOpen.bind(this));
    ws.on("message", this.handleStreamingMessage.bind(this));
    ws.on("close", this.handleStreamingClose.bind(this));
    ws.on("error", this.handleStreamingError.bind(this));
  }

  async reconnectStreaming() {
    const log = this.log;
    if (this._reconnectTimer) return;

    log.info({ msg: "streamingReconnect" });

    this._reconnectTimer = setTimeout(() => {
      if (this.ws) this.ws.close();
      this.connectStreaming();
      this._reconnectTimer = null;
    }, this.parent.config.get("streamReconnectDelay"));
  }

  async handleStreamingOpen() {
    this.log.trace({ msg: "open" });
    // parent.onStart();
  }

  async handleStreamingClose() {
    this.log.info({ msg: "streamingClosed" });
    this.ws = null;
    this.reconnectStreaming();
  }

  async handleStreamingError(err) {
    this.log.info({ msg: "streamingError", err });
    this.ws = null;
    this.reconnectStreaming();
  }

  async handleStreamingMessage(dataBuf) {
    try {
      const log = this.log;
      const json = dataBuf.toString();
      const { stream, event, payload: payloadRaw } = JSON.parse(json);
      log.trace({ msg: "received", stream, event, payload: payloadRaw });

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
            msg: "Unhandled event",
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
    const { db } = this.parent;
    const log = this.log;

    const payload = JSON.parse(payloadRaw);
    const { id, url, content, account, visibility } = payload;
    const { acct } = account;
    if (visibility !== "public") return;

    await db.putStatusFromPayload(payload);

    log.info({ msg: event, id });
    log.debug({ msg: event, id, acct, url, content });
  }

  async handleStatusDelete(id) {
    const { db } = this.parent;
    const log = this.log;
    await db.deleteStatus(id);
    log.info({ msg: "delete", id });
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
