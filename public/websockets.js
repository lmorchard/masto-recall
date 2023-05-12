const RECONNECT_DELAY = 2000;

export class WebSocketHandler {
  constructor({
    socketPath = "/socket",
    log = console,
    reconnectDelay = RECONNECT_DELAY,
  } = {}) {
    this.log = log;
    this.reconnectDelay = reconnectDelay;
    this.resetId();

    const { protocol, host } = window.location;
    const socketProtocol = protocol === "https:" ? "wss:" : "ws:";
    this.socketURL = `${socketProtocol}//${host}${socketPath}`;
  }

  resetId() {
    this.id = `${Date.now()}-${Math.random()}`;
  }

  connect() {
    this.resetId();
    const { log } = this;
    log.debug(`Connecting to websocket at ${this.socketURL}`);

    this.socket = new WebSocket(this.socketURL);
    this.socketAbortController = new AbortController();
    const { signal } = this.socketAbortController;

    const handlerNames = ["Open", "Close", "Error", "Message"];
    for (const name of handlerNames) {
      this.socket.addEventListener(
        name.toLowerCase(),
        this[`handle${name}`].bind(this),
        { signal }
      );
    }
    
    return this;
  }

  disconnect() {
    if (this.socketAbortController) {
      this.socketAbortController.abort();
    }
    if (this.socket) {
      this.socket.close();
    }
    return this;
  }

  reconnect() {
    const { log } = this;
    log.debug("websocket reconnect", this.id);
    this.disconnect();
    setTimeout(() => this.connect(), this.reconnectDelay);
    return this;
  }

  handleOpen(event) {
    const { log, socket } = this;
    log.debug("websocket open", this.id);
    socket.send("Hello Server!");
  }

  handleClose(event) {
    const { log } = this;
    log.debug("websocket close", this.id);
    this.reconnect();
  }

  handleError(event) {
    const { log } = this;
    log.error("websocket error", this.id);
    this.reconnect();
  }

  handleMessage(event) {
    const { log } = this;
    log.debug("Message from server", this.id, event.data);
  }
}
