import BasePlugin from "./base.js";

export default class EventsPlugin extends BasePlugin {
  constructor(parent) {
    super(parent);
    this.subscriptions = new Map();
    this.lastId = 0;
  }

  on(eventName, handler) {
    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, new Map());
    }
    const id = this.lastId++;
    this.subscriptions.get(eventName).set(id, handler);
    return id;
  }

  off(eventName, id) {
    if (!this.subscriptions.has(eventName)) return;
    this.subscriptions.get(eventName).delete(id);
  }

  async emit(eventName, ...data) {
    if (!this.subscriptions.has(eventName)) return;
    const results = [];
    const handlers = this.subscriptions.get(eventName).values();
    for (const handler of handlers) {
      results.push(handler(...data));
    }
    return Promise.all(results);
  }
}
