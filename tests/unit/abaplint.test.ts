import { describe, expect, it } from "vitest";
import { abaplintFilename, lintSource, outline, prettyPrint } from "../../src/shared/abaplint.js";
import { searchPattern, splitSourceUri } from "../../src/server/backend/util.js";

describe("local lint", () => {
  it("reports parser errors and obsolete statements without needing the system", () => {
    const source = "REPORT ztest.\nDATA lv_x TYPE string.\nWRITE lv_x\nMOVE 1 TO lv_x.\nlv_x = zcl_somewhere=>value( ).\n";
    const issues = lintSource({ name: "ZTEST", type: "PROG/P", source });
    const keys = issues.map((i) => `${i.code}@${i.line}`);
    expect(keys).toContain("parser_error@3");
    expect(keys).toContain("obsolete_statement@4");
    // References to unknown objects are left to the SAP check.
    expect(issues.some((i) => i.line === 5)).toBe(false);
    expect(issues.find((i) => i.code === "parser_error")?.severity).toBe("error");
    expect(issues.find((i) => i.code === "obsolete_statement")?.severity).toBe("warning");
  });

  it("is clean for valid code", () => {
    const source = "CLASS zcl_ok DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\nCLASS zcl_ok IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n";
    expect(lintSource({ name: "ZCL_OK", type: "CLAS/OC", source })).toEqual([]);
  });

  it("maps object types to abaplint file names", () => {
    expect(abaplintFilename("ZCL_A", "CLAS/OC")).toBe("zcl_a.clas.abap");
    expect(abaplintFilename("ZIF_A", "INTF/OI")).toBe("zif_a.intf.abap");
    expect(abaplintFilename("/ABC/PROG", "PROG/P")).toBe("#abc#prog.prog.abap");
    expect(abaplintFilename("Z_FM", "FUGR/FF")).toBe("z_fm.prog.abap");
  });
});

describe("outline", () => {
  it("lists classes, methods, attributes, forms and events", () => {
    const source = [
      "REPORT ztest.",
      "CLASS lcl_app DEFINITION.",
      "  PUBLIC SECTION.",
      "    CLASS-METHODS create.",
      "    METHODS run.",
      "    DATA mv_count TYPE i.",
      "ENDCLASS.",
      "CLASS lcl_app IMPLEMENTATION.",
      "  METHOD create.",
      "  ENDMETHOD.",
      "  METHOD run.",
      "  ENDMETHOD.",
      "ENDCLASS.",
      "FORM legacy.",
      "ENDFORM.",
      "START-OF-SELECTION.",
      "  PERFORM legacy.",
    ].join("\n");
    const items = outline({ name: "ZTEST", type: "PROG/P", source });
    expect(items.map((i) => `${i.kind}:${i.name}:${i.line}`)).toEqual([
      "class:lcl_app:2",
      "class:lcl_app:8",
      "form:legacy:14",
      "event:START-OF-SELECTION:16",
    ]);
    expect(items[0].detail).toBe("definition");
    expect(items[0].children.map((c) => `${c.kind}:${c.name}:${c.detail ?? ""}`)).toEqual(["method:create:static", "method:run:", "attribute:mv_count:"]);
    expect(items[1].children.map((c) => c.name)).toEqual(["create", "run"]);
    // Block ranges, used for sticky scroll and "go to symbol".
    expect(items.map((i) => [i.line, i.endLine])).toEqual([
      [2, 7],
      [8, 13],
      [14, 15],
      [16, 17],
    ]);
    expect(items[1].children.map((c) => [c.line, c.endLine])).toEqual([
      [9, 10],
      [11, 12],
    ]);
  });
});

describe("pretty printer", () => {
  it("upper-cases keywords and indents blocks", () => {
    const out = prettyPrint({ name: "Z", type: "PROG/P", source: "report z.\ndo 3 times.\nwrite 'x'.\nenddo." });
    expect(out).toBe("REPORT z.\nDO 3 TIMES.\n  WRITE 'x'.\nENDDO.");
  });
});

describe("uri helpers", () => {
  it("splits source URIs from object URIs", () => {
    expect(splitSourceUri("/sap/bc/adt/oo/classes/zcl_a/source/main#start=3,1")).toEqual({
      objectUri: "/sap/bc/adt/oo/classes/zcl_a",
      sourceUri: "/sap/bc/adt/oo/classes/zcl_a/source/main",
    });
    expect(splitSourceUri("/sap/bc/adt/oo/classes/zcl_a/includes/testclasses")).toEqual({
      objectUri: "/sap/bc/adt/oo/classes/zcl_a",
      sourceUri: "/sap/bc/adt/oo/classes/zcl_a/includes/testclasses",
    });
    expect(splitSourceUri("/sap/bc/adt/programs/programs/zp")).toEqual({ objectUri: "/sap/bc/adt/programs/programs/zp" });
  });

  it("builds Eclipse-like search patterns", () => {
    expect(searchPattern(" zcl_ ")).toBe("ZCL_*");
    expect(searchPattern("z*flight*")).toBe("Z*FLIGHT*");
    expect(searchPattern("")).toBe("");
  });
});
