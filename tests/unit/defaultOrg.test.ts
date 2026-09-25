import { describe, expect, test } from "bun:test";
import { defaultOrgOf } from "../../domain/defaultOrg.ts";

describe("organisation choisie par défaut", () => {
  test("la dernière ouverte, si elle est encore dans la liste, écrite comme GitHub l'écrit", () => {
    expect(defaultOrgOf(["Acme", "Mask-AI-FR"], "mask-ai-fr")).toBe("Mask-AI-FR");
  });

  test("sinon la première de la liste : rien de retenu, ou une organisation qui n'est plus là", () => {
    expect(defaultOrgOf(["Acme", "Mask-AI-FR"], null)).toBe("Acme");
    expect(defaultOrgOf(["Acme", "Mask-AI-FR"], "gone-org")).toBe("Acme");
  });

  test("aucune organisation : aucune par défaut", () => {
    expect(defaultOrgOf([], "Acme")).toBeNull();
  });
});
