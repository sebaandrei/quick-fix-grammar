import { describe, expect, it } from "vitest";

import { modes } from "../core/modes";
import { TONES, loadOrderedTones, orderTones } from "./tones";

const ids = TONES.map((t) => t.id);

describe("TONES", () => {
  it.each(TONES)("$id maps to a real mode", (t) => {
    expect(t.mode).toBe(`tone-${t.id}`);
    expect(modes[t.mode]).toBeDefined();
  });
});

describe("orderTones", () => {
  it("default order for undefined, null and empty", () => {
    for (const v of [undefined, null, "", "zzz"]) expect(orderTones(v).map((t) => t.id)).toEqual(ids);
  });
  it("puts last first and keeps the rest in order", () => {
    expect(orderTones("casual").map((t) => t.id)).toEqual([
      "casual",
      "professional",
      "friendly",
      "confident",
      "direct",
    ]);
  });
  it("first tone stays first", () => expect(orderTones("professional").map((t) => t.id)).toEqual(ids));
  it("last tone moves to front", () => expect(orderTones("direct")[0].id).toBe("direct"));
});

describe("loadOrderedTones", () => {
  it("orders by stored value", async () => {
    expect((await loadOrderedTones(async () => "friendly"))[0].id).toBe("friendly");
  });
  it("handles missing value", async () => {
    expect((await loadOrderedTones(async () => undefined)).map((t) => t.id)).toEqual(ids);
  });
  it("falls back to default order when storage throws", async () => {
    const out = await loadOrderedTones(async () => {
      throw new Error("storage down");
    });
    expect(out.map((t) => t.id)).toEqual(ids);
  });
});
