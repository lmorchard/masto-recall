import URL from "url";
import WebSocket from "ws";
import BasePlugin from "./base.js";

export default class StreamingPlugin extends BasePlugin {
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
      stream: "public",
      // stream: "user:notification"
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
    const { db } = this.parent;
    const log = this.log;
    try {
      const json = dataBuf.toString();
      const { stream, event, payload } = JSON.parse(json);
      log.trace({ msg: "received", stream, event, payload });

      switch (event) {
        case "status.update":
        case "update": {
          const payloadParsed = JSON.parse(payload);
          await db.putStatusFromPayload(payloadParsed);

          const { id, url, content, account } = payloadParsed;
          const { acct } = account;
          log.info({ msg: event, id });
          log.debug({ msg: event, id, acct, url, content });
          break;
        }
        case "delete": {
          await db.deleteStatus(payload);
          log.info({ msg: event, payload });
          break;
        }
        default: {
          log.debug({
            msg: "Unhandled event",
            event,
            payload,
          });
          break;
        }
      }
    } catch (err) {
      log.error({ msg: "received", err });
    }
  }
}
