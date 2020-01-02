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
  };

  constructor(parent) {
    super(parent);
    const { program } = parent.cli;
    program
      .command("streaming")
      .description("connect to streaming websocket API")
      .action(this.runStreaming.bind(this));
  }

  async runStreaming() {
    const { parent } = this;
    const { config } = parent;
    const log = this.log;
    const baseURL = config.get("apiBaseUrl");

    const params = new URL.URLSearchParams({
      access_token: config.get("accessToken"),
      stream: config.get("streamTopic"),
    });
    const wsBaseURL = baseURL.replace("http", "ws");
    const wsURL = `${wsBaseURL}/api/v1/streaming`;
    log.info({ msg: "Connecting to websocket", wsURL });

    const ws = (this.ws = new WebSocket(`${wsURL}?${params.toString()}`, {
      headers: {
        "User-Agent": config.get("userAgent"),
      },
    }));

    this.ws.on("open", this.handleStreamingOpen.bind(this));
    this.ws.on("message", this.handleStreamingMessage.bind(this));

    return new Promise((resolve, reject) => {
      ws.on("close", resolve);
      ws.on("error", reject);
    });
  }

  async handleStreamingOpen() {
    const { parent } = this;
    const log = this.log;
    log.trace({ msg: "open" });
    // parent.onStart();
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
    const { id, url, content, account } = payload;
    const { acct } = account;
    if (visibility !== "public") return;

    await db.putStatusFromPayload(payload);

    log.info({ msg: event, id });
    log.debug({ msg: event, id, acct, url, content });
  }

  async handleStatusDelete(payloadRaw) {
    const { db } = this.parent;
    const log = this.log;
    await db.deleteStatus(payloadRaw);
    log.info({ msg: "delete", payload: payloadRaw });
  }

  async handleNotification(payloadRaw) {
    const log = this.log;
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
