import { createServer, type Server } from "node:http";
import { config } from "./config.js";
import { logger } from "./logger.js";

export function startHealthServer(): Server {
  const server = createServer((request, response) => {
    if (request.url === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"status":"ok"}'); return; }
    response.writeHead(404).end();
  });
  server.listen(config.PORT, "0.0.0.0", () => logger.info({ port: config.PORT }, "Health server listening"));
  return server;
}
