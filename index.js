#!/usr/bin/env node
import App from "./lib/app.js";

async function main() {
  const app = new App();
  await app.run();
}

main().catch(console.error);
