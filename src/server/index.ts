import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Built layout: dist/server/server/index.js next to dist/client.
const clientDir = process.env.CLIENT_DIR ?? path.resolve(here, "../../client");

const port = Number(process.env.PORT ?? 3417);
// Local-only by default: the server holds SAP sessions, so it should not be reachable from the network.
const host = process.env.HOST ?? "127.0.0.1";

const { app, close } = createApp({ clientDir });
const server = app.listen(port, host, () => {
  console.log(`Alva em http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void close().finally(() => process.exit(0));
  });
}
