import { describe, expect, test } from "bun:test";
import { checkLimitChanges, defaultLimits, LIMIT_SETTINGS } from "../../domain/settingsCatalog.ts";

describe("catalogue des réglages", () => {
  test("clés uniques, valeurs par défaut dans leurs bornes", () => {
    const keys = LIMIT_SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const setting of LIMIT_SETTINGS) {
      expect(setting.defaultValue).toBeGreaterThanOrEqual(setting.min);
      expect(setting.defaultValue).toBeLessThanOrEqual(setting.max);
    }
    expect(defaultLimits().reposMax).toBe(1000);
  });

  test("un plafond inconnu, non entier ou hors bornes est refusé et nommé", () => {
    expect(checkLimitChanges({ reposMax: 500, branchesMax: 0, nope: 3, dispatchConcurrency: 2.5 })).toEqual({
      accepted: { reposMax: 500 },
      invalid: ["branchesMax", "nope", "dispatchConcurrency"],
    });
  });
});
