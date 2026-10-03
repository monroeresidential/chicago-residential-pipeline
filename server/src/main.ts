import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { createApp } from "./http/app";
import { startScheduler } from "./jobs/scheduler";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = createApp({ db, config });
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level: "info", msg: `listening on ${info.port}` })));
const stopScheduler = startScheduler(db, config);

function shutdown() {
  stopScheduler();
  server.close(() => void db.destroy().then(() => process.exit(0)));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
