import BasePlugin from "../base.js";

export default class ServerWebsocketsPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    this.connections = new Map();
  }

  async extendServer(server) {
    server.get(
      "/socket",
      { websocket: true },
      this.acceptConnection.bind(this)
    );
  }

  acceptConnection(connection, request) {
    this.adoptConnectionHandler(
      new WebSocketConnectionHandler(this, connection)
    );
  }

  adoptConnectionHandler(handler) {
    this.connections.set(handler.id, handler);
    handler.init();
  }

  dropConnectionHandler(handler) {
    this.connections.delete(handler.id);
    handler.destroy();
  }
}

class WebSocketConnectionHandler {
  constructor(parent, connection) {
    this.id = `${Date.now()}-${Math.random()}`;
    this.parent = parent;
    this.connection = connection;
  }

  init() {
    const { socket } = this.connection;
    const { log } = this.parent;
    const { events, logging } = this.parent.parent;
    const { EVENT_LOG } = logging.constructor;

    log.trace({ msg: "websocketInit", handlerId: this.id });

    this.eventHandles = [
      events.on(EVENT_LOG, (msg) => {
        socket.send(JSON.stringify(msg));
      }),
    ];

    socket.on("close", (event) => {
      log.info({ msg: "websocketClose" });
      this.parent.dropConnectionHandler(this);
    });

    socket.on("error", (event) => {
      log.info({ msg: "websocketError" });
      this.parent.dropConnectionHandler(this);
    });

    socket.on("message", (event) => {
      log.info({ msg: "websocketMessage", event });
    });
  }

  destroy() {
    const { events, logging } = this.parent.parent;
    const { EVENT_LOG } = logging.constructor;
    this.eventHandles.forEach((id) => events.off(EVENT_LOG, id));
  }
}
