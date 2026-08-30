import { createServer, IncomingMessage, ServerResponse } from "node:http";

const PORT = 8000;

function respondJson(response: ServerResponse, statusCode: number, body: object): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "POST" || request.url !== "/recordings") {
    respondJson(response, 404, { error: { code: "not_found", message: "Not found" } });
    return;
  }

  request.resume();
  request.on("end", () => {
    respondJson(response, 201, {
      id: "00000000-0000-4000-8000-000000000001",
      task_name: "stub recording",
      duration_seconds: 30,
      status: "uploaded",
      created_at: "2026-08-30T00:00:00Z"
    });
  });
  request.on("error", () => {
    respondJson(response, 400, { error: { code: "invalid_upload", message: "Could not read the upload" } });
  });
}

const server = createServer(handleRequest);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Cannot start the recording stub: 127.0.0.1:${PORT} is already in use.`);
    return;
  }
  console.error("Cannot start the recording stub.", error);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Owari recording stub listening on http://127.0.0.1:${PORT}`);
});
