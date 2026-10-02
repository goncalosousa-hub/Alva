import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { candidatesFor, resolveSystemUrl } from "../../src/server/backend/discover.js";

function serve(handler: (path: string) => number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(handler(req.url ?? ""));
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function serveWith(handler: (path: string, res: import("node:http").ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => handler(req.url ?? "", res));
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

let adt: { server: Server; port: number };
let plainWeb: { server: Server; port: number };

beforeAll(async () => {
  // An SAP system: the ADT discovery asks for logon.
  adt = await serve((path) => (path.startsWith("/sap/bc/adt/discovery") ? 401 : 404));
  // A web server without ADT.
  plainWeb = await serve(() => 404);
});

afterAll(() => {
  adt.server.close();
  plainWeb.server.close();
});

describe("system URL", () => {
  it("uses a full URL as is, keeping only scheme, host and port", async () => {
    expect(await resolveSystemUrl("https://sap.example.com:44300/sap/bc/gui/sap/its/webgui?sap-client=100")).toBe("https://sap.example.com:44300");
  });

  it("tries the usual SAP ports for a bare server", () => {
    expect(candidatesFor("10.10.98.24")).toEqual([
      "https://10.10.98.24:44300",
      "http://10.10.98.24:8000",
      "https://10.10.98.24:443",
      "http://10.10.98.24:80",
      "https://10.10.98.24:44301",
      "http://10.10.98.24:8001",
    ]);
    expect(candidatesFor("sap-qas:8001")).toEqual(["https://sap-qas:8001", "http://sap-qas:8001"]);
    expect(candidatesFor("not a url")).toBeNull();
  });

  it("finds the scheme of a server given with its port", async () => {
    expect(await resolveSystemUrl(`127.0.0.1:${adt.port}`)).toBe(`http://127.0.0.1:${adt.port}`);
  });

  it("explains when the server answers but ADT does not", async () => {
    await expect(resolveSystemUrl(`127.0.0.1:${plainWeb.port}`)).rejects.toMatchObject({ code: "adtInactive" });
  });

  it("explains when nothing answers", async () => {
    await expect(resolveSystemUrl("127.0.0.1:9", 1000)).rejects.toMatchObject({ code: "network", status: 502 });
  });

  it("rejects text that is not an address", async () => {
    await expect(resolveSystemUrl("not a url")).rejects.toMatchObject({ status: 400 });
  });

  it("follows a redirect to another address (e.g. HTTP to HTTPS)", async () => {
    const redirecting = await serveWith((_path, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${adt.port}/sap/bc/adt/discovery` });
      res.end();
    });
    expect(await resolveSystemUrl(`127.0.0.1:${redirecting.port}`)).toBe(`http://127.0.0.1:${adt.port}`);
    redirecting.server.close();
  });

  it("keeps a server that redirects to its own logon page", async () => {
    const logonPage = await serveWith((_path, res) => {
      res.writeHead(302, { location: "/sap/public/bc/icf/logon" });
      res.end();
    });
    expect(await resolveSystemUrl(`127.0.0.1:${logonPage.port}`)).toBe(`http://127.0.0.1:${logonPage.port}`);
    logonPage.server.close();
  });

  it("does not follow a redirect to another site (SAML logon, e.g. Google)", async () => {
    const saml = await serveWith((_path, res) => {
      res.writeHead(302, { location: "https://accounts.google.com/o/saml2/idp?SAMLRequest=x" });
      res.end();
    });
    expect(await resolveSystemUrl(`127.0.0.1:${saml.port}`)).toBe(`http://127.0.0.1:${saml.port}`);
    saml.server.close();
  });
});
