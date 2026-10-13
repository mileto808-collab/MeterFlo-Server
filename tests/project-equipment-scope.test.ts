import assert from "node:assert/strict";
import test from "node:test";
import {
  getProjectEquipmentVisibility, omitInapplicableEquipmentFields,
} from "../shared/project-equipment-scope";

test("changeout and reading-only forms use their own equipment settings", () => {
  for (const wizardMode of ["changeout", "reading_only"]) {
    for (const scope of ["system", "module", "both", "user_choice"]) {
      const settings = {
        wizardMode,
        changeoutEquipmentType: wizardMode === "changeout" ? scope : "module",
        readingEquipmentType: wizardMode === "reading_only" ? scope : "system",
      };
      assert.deepEqual(getProjectEquipmentVisibility(settings), {
        showSystem: scope !== "module", showModule: scope !== "system",
      });
    }
  }
});

test("workflow user choice includes the union of permitted equipment", () => {
  for (const changeoutEquipmentType of ["system", "module", "both", "user_choice"]) {
    for (const readingEquipmentType of ["system", "module", "both", "user_choice"]) {
      assert.deepEqual(getProjectEquipmentVisibility({
        wizardMode: "user_choice", changeoutEquipmentType, readingEquipmentType,
      }), {
        showSystem: changeoutEquipmentType !== "module" || readingEquipmentType !== "module",
        showModule: changeoutEquipmentType !== "system" || readingEquipmentType !== "system",
      });
    }
  }
});

test("legacy unspecified settings show both without hiding existing functionality", () => {
  for (const project of [undefined, null, {}, { wizardMode: "reading_only" }]) {
    assert.deepEqual(getProjectEquipmentVisibility(project), { showSystem: true, showModule: true });
  }
});

test("manual writes omit hidden device values, not GPS or customer metadata; source is unchanged", () => {
  const source = {
    customerWoId: "scope-fixture", customerName: "Fixture",
    oldSystemId: "OLD-S", newSystemId: "NEW-S",
    oldSystemType: "S", newSystemType: "S",
    oldSystemReading: "123.123456", newSystemReading: "456.123456",
    oldModuleId: "OLD-M", newModuleId: "NEW-M",
    oldModuleType: "M", newModuleType: "M",
    oldModuleRead: "12.123456", newModuleRead: "34.123456",
    oldModuleReading: "12.123456", newModuleReading: "34.123456",
    oldGps: "40,-74", newGps: "41,-75", notes: "Historical values retained",
  };
  const original = { ...source };
  for (const scope of ["system", "module", "both"]) {
    const result = omitInapplicableEquipmentFields(source,
      getProjectEquipmentVisibility({ changeoutEquipmentType: scope }));
    for (const key of Object.keys(source)) {
      const hidden = (scope === "system" && /Module/.test(key))
        || (scope === "module" && /System/.test(key));
      assert.equal(Object.hasOwn(result, key), !hidden, `${scope}: ${key}`);
      if (!hidden) assert.equal(result[key as keyof typeof source], source[key as keyof typeof source]);
    }
    assert.deepEqual(source, original);
    assert.notEqual(result, source);
  }
});
