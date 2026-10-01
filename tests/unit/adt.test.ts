import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdtBackend } from "../../src/server/backend/adt.js";
import { BackendError } from "../../src/server/backend/types.js";

/** A stand-in for an SAP system that rejects every logon. */
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(401, { "content-type": "text/html", "www-authenticate": 'Basic realm="SAP NetWeaver Application Server"' });
    res.end("<html><body>Logon failed</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function connectError(target: string): Promise<BackendError> {
  try {
    await AdtBackend.connect({ url: target, user: "dev", password: "wrong", client: "100", language: "EN" });
  } catch (e) {
    expect(e).toBeInstanceOf(BackendError);
    return e as BackendError;
  }
  throw new Error("connect should have failed");
}

describe("ADT connection errors", () => {
  it("reports rejected credentials as 401", async () => {
    const err = await connectError(url);
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  });

  it("reports an unreachable system", async () => {
    // Port 9 (discard) on localhost is closed: connection refused.
    const err = await connectError("http://127.0.0.1:9");
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/inacessível|ECONNREFUSED/i);
  });
});
