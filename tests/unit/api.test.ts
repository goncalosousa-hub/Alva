import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { DemoBackend } from "../../src/server/backend/demo.js";
import type { OpenedObject } from "../../src/shared/types.js";

const H = { "x-alva": "1" };
const PROGRAM = "/sap/bc/adt/programs/programs/zr_flight_report";
const LOCAL_PROGRAM = "/sap/bc/adt/programs/programs/zhello_alva";
const CLASS = "/sap/bc/adt/oo/classes/zcl_flight_service";

let ctx: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;

beforeEach(async () => {
  ctx = createApp();
  agent = request.agent(ctx.app);
  await agent.post("/api/session").set(H).send({ demo: true }).expect(200);
});

afterEach(async () => {
  await ctx.close();
});

async function open(uri: string): Promise<OpenedObject> {
  const res = await agent.get("/api/object").set(H).query({ uri }).expect(200);
  return res.body;
}

describe("session", () => {
  it("rejects calls without the client header", async () => {
    await agent.get("/api/session").expect(403);
  });

  it("requires a session", async () => {
    const res = await request(ctx.app).get("/api/session").set(H).expect(200);
    expect(res.body).toBeNull();
    await request(ctx.app).get("/api/search").query({ q: "Z" }).set(H).expect(401);
  });

  it("returns the demo session and logs out", async () => {
    const res = await agent.get("/api/session").set(H).expect(200);
    expect(res.body).toMatchObject({ systemId: "DEMO", user: "DEVELOPER", demo: true });
    await agent.delete("/api/session").set(H).expect(200);
    expect((await agent.get("/api/session").set(H).expect(200)).body).toBeNull();
  });

  it("validates the connection input", async () => {
    const res = await request(ctx.app).post("/api/session").set(H).send({ url: "not a url", user: "x", password: "y" }).expect(400);
    expect(res.body.error).toMatch(/URL/);
  });

  it("logs on a real system through the connector", async () => {
    const seen: unknown[] = [];
    const custom = createApp({
      connect: async (input) => {
        seen.push(input);
        return new DemoBackend();
      },
    });
    await request(custom.app)
      .post("/api/session")
      .set(H)
      .send({ url: "https://sap.example.com:44300", user: "dev", password: "secret", client: "100", language: "PT", allowSelfSigned: true })
      .expect(200);
    expect(seen).toEqual([
      { url: "https://sap.example.com:44300", user: "dev", password: "secret", client: "100", language: "PT", allowSelfSigned: true },
    ]);
    await custom.close();
  });
});

describe("repository", () => {
  it("searches with an implicit wildcard, case-insensitive", async () => {
    const res = await agent.get("/api/search").set(H).query({ q: "zcl_" }).expect(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(["ZCL_FLIGHT_SERVICE", "ZCL_STRING_UTILS"]);
  });

  it("filters the search by type", async () => {
    const res = await agent.get("/api/search").set(H).query({ q: "Z", type: "INTF" }).expect(200);
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(["ZIF_FLIGHT_REPOSITORY"]);
  });

  it("lists package contents with sub-packages", async () => {
    const res = await agent.get("/api/packages/ZALVA_DEMO").set(H).expect(200);
    const names = res.body.map((n: { name: string }) => n.name);
    expect(names).toContain("ZALVA_DEMO_UTIL");
    expect(names).toContain("ZCL_FLIGHT_SERVICE");
    expect(res.body.find((n: { name: string }) => n.name === "ZALVA_DEMO_UTIL").expandable).toBe(true);
  });

  it("returns 404 for unknown packages", async () => {
    await agent.get("/api/packages/ZNOPE").set(H).expect(404);
  });
});

describe("editing", () => {
  it("opens an object with its source", async () => {
    const obj = await open(CLASS);
    expect(obj.ref.name).toBe("ZCL_FLIGHT_SERVICE");
    expect(obj.sourceUri).toBe(`${CLASS}/source/main`);
    expect(obj.source).toContain("CLASS zcl_flight_service DEFINITION");
    expect(obj.language).toBe("abap");
    expect(obj.version).toBe("active");
  });

  it("lists the includes of a class and opens one", async () => {
    const obj = await open(CLASS);
    expect(obj.include).toBe("main");
    expect(obj.includes?.map((i) => i.kind)).toEqual(["main", "definitions", "implementations", "macros", "testclasses"]);
    const tests = await open(obj.includes!.find((i) => i.kind === "testclasses")!.uri);
    expect(tests.sourceUri).toBe(`${CLASS}/includes/testclasses`);
    expect(tests.include).toBe("testclasses");
    expect(tests.source).toContain("CLASS ltc_flight_service DEFINITION FINAL FOR TESTING");
    expect((await open(PROGRAM)).includes).toBeUndefined();
  });

  it("checks a class include against the rest of the class", async () => {
    const uri = `${CLASS}/includes/testclasses`;
    const tests = await open(uri);
    const clean = await agent.post("/api/object/check").set(H).send({ objectUri: CLASS, sourceUri: uri, source: tests.source }).expect(200);
    expect(clean.body).toEqual([]);
    const broken = tests.source.replace("mo_cut->occupation(", "mo_cut->occupancy(");
    const res = await agent.post("/api/object/check").set(H).send({ objectUri: CLASS, sourceUri: uri, source: broken }).expect(200);
    expect(res.body[0].text).toMatch(/occupancy/i);
  });

  it("the demo sources pass the syntax check", async () => {
    for (const uri of [PROGRAM, LOCAL_PROGRAM, CLASS, "/sap/bc/adt/oo/interfaces/zif_flight_repository", "/sap/bc/adt/oo/classes/zcl_string_utils"]) {
      const obj = await open(uri);
      const res = await agent.post("/api/object/check").set(H).send({ objectUri: uri, sourceUri: obj.sourceUri, source: obj.source }).expect(200);
      expect(res.body, uri).toEqual([]);
    }
  });

  it("reports syntax errors with positions", async () => {
    const obj = await open(LOCAL_PROGRAM);
    const source = obj.source.replace("lv_name ) }", "lv_nome ) }");
    const res = await agent.post("/api/object/check").set(H).send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source }).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ severity: "error", line: 6, source: "sap" });
    expect(res.body[0].text).toMatch(/lv_nome/i);
  });

  it("saves a local object without a transport, then activates it", async () => {
    const obj = await open(LOCAL_PROGRAM);
    const source = obj.source.replace("`alva`", "`mundo`");
    const saved = await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source, etag: obj.etag })
      .expect(200);
    expect(saved.body.status).toBe("saved");

    expect((await open(LOCAL_PROGRAM)).version).toBe("inactive");
    const inactive = await agent.get("/api/inactive").set(H).expect(200);
    expect(inactive.body.map((o: { name: string }) => o.name)).toEqual(["ZHELLO_ALVA"]);

    const act = await agent.post("/api/object/activate").set(H).send({ name: "ZHELLO_ALVA", objectUri: LOCAL_PROGRAM }).expect(200);
    expect(act.body).toEqual({ success: true, messages: [] });
    const reopened = await open(LOCAL_PROGRAM);
    expect(reopened.version).toBe("active");
    expect(reopened.source).toContain("mundo");
  });

  it("asks for a transport in a transportable package, and remembers it", async () => {
    const obj = await open(PROGRAM);
    const source = obj.source.replace("DEFAULT 'TP'", "DEFAULT 'LH'");
    const first = await agent.post("/api/object/save").set(H).send({ objectUri: PROGRAM, sourceUri: obj.sourceUri, source, etag: obj.etag }).expect(200);
    expect(first.body.status).toBe("needsTransport");
    expect(first.body.transports[0].number).toBe("DEVK900123");

    const bad = await agent.post("/api/object/save").set(H).send({ objectUri: PROGRAM, sourceUri: obj.sourceUri, source, transport: "DEVK999999" }).expect(400);
    expect(bad.body.error).toMatch(/DEVK999999/);

    const second = await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: PROGRAM, sourceUri: obj.sourceUri, source, etag: obj.etag, transport: "devk900123" })
      .expect(200);
    expect(second.body).toMatchObject({ status: "saved", transport: "DEVK900123" });

    const third = await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: PROGRAM, sourceUri: obj.sourceUri, source: source + "\n", etag: second.body.etag })
      .expect(200);
    expect(third.body).toMatchObject({ status: "saved", transport: "DEVK900123" });
  });

  it("refuses to overwrite changes made since the object was opened", async () => {
    const obj = await open(LOCAL_PROGRAM);
    await agent.post("/api/object/save").set(H).send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source: obj.source + "\n* a\n", etag: obj.etag }).expect(200);
    const conflict = await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source: obj.source + "\n* b\n", etag: obj.etag })
      .expect(409);
    expect(conflict.body.code).toBe("conflict");
    await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source: obj.source + "\n* b\n", etag: obj.etag, force: true })
      .expect(200);
  });

  it("does not activate an object with syntax errors", async () => {
    const obj = await open(LOCAL_PROGRAM);
    await agent
      .post("/api/object/save")
      .set(H)
      .send({ objectUri: LOCAL_PROGRAM, sourceUri: obj.sourceUri, source: obj.source.replace("lv_name ) }", "lv_nome ) }") })
      .expect(200);
    const act = await agent.post("/api/object/activate").set(H).send({ name: "ZHELLO_ALVA", objectUri: LOCAL_PROGRAM }).expect(200);
    expect(act.body.success).toBe(false);
    expect(act.body.messages[0]).toMatchObject({ severity: "error", line: 6 });
  });

  it("completes identifiers, object names and keywords", async () => {
    const obj = await open(LOCAL_PROGRAM);
    const source = obj.source + "  zcl_s";
    const lines = source.split("\n");
    const res = await agent
      .post("/api/object/completion")
      .set(H)
      .send({ sourceUri: obj.sourceUri, source, line: lines.length, column: lines[lines.length - 1].length })
      .expect(200);
    expect(res.body.map((c: { label: string }) => c.label)).toEqual(["zcl_string_utils"]);
    expect(res.body[0].prefixLength).toBe(5);
  });

  it("navigates to the definition of another object", async () => {
    const obj = await open(PROGRAM);
    const lines = obj.source.split("\n");
    const line = lines.findIndex((l) => l.includes("NEW zcl_flight_service")) + 1;
    const start = lines[line - 1].indexOf("zcl_flight_service");
    const res = await agent
      .post("/api/object/definition")
      .set(H)
      .send({ sourceUri: obj.sourceUri, source: obj.source, line, startColumn: start, endColumn: start + "zcl_flight_service".length })
      .expect(200);
    expect(res.body.target).toEqual({ uri: `${CLASS}/source/main`, line: 1, column: 1 });
  });

  it("pretty prints", async () => {
    const res = await agent.post("/api/prettyprint").set(H).send({ source: "report z.\ndata lv type i.\nif lv = 1.\nwrite lv.\nendif." }).expect(200);
    expect(res.body.source).toContain("IF lv = 1.\n  WRITE lv.\nENDIF.");
  });

  it("rejects object URIs outside ADT", async () => {
    await agent.get("/api/object").set(H).query({ uri: "/etc/passwd" }).expect(400);
  });
});
