import assert from "node:assert/strict";
import test from "node:test";
import {
  getProjectEquipmentVisibility, omitInapplicableEquipmentFields,
} from "../shared/project-equipment-scope";
import { buildWorkOrderEquipmentHtml } from "../client/src/components/work-order-pdf-equipment";

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

const legacyEquipment = Object.freeze({
  oldSystemId: "OLD-SYSTEM", newSystemId: "NEW-SYSTEM",
  oldSystemReading: 0, newSystemReading: "123.123456",
  oldSystemType: "SYSTEM-TYPE", newSystemType: "SYSTEM-TYPE",
  oldModuleId: "OLD-MODULE", newModuleId: "NEW-MODULE",
  oldModuleRead: 0, newModuleRead: "456.123456",
  oldModuleType: "MODULE-TYPE", newModuleType: "MODULE-TYPE",
  oldGps: "40,-74", newGps: "41,-75",
});

test("PDF equipment rendering honors every effective workflow scope with legacy data", () => {
  const original = { ...legacyEquipment };
  for (const wizardMode of ["changeout", "reading_only", "user_choice"]) {
    for (const changeoutEquipmentType of ["system", "module", "both", "user_choice"]) {
      for (const readingEquipmentType of ["system", "module", "both", "user_choice"]) {
        const visibility = getProjectEquipmentVisibility({
          wizardMode, changeoutEquipmentType, readingEquipmentType,
        });
        const html = buildWorkOrderEquipmentHtml(legacyEquipment, visibility);
        for (const heading of ["Old System", "New System"]) {
          assert.equal(html.includes(heading), visibility.showSystem);
        }
        for (const heading of ["Old Module", "New Module"]) {
          assert.equal(html.includes(heading), visibility.showModule);
        }
        for (const [key, value] of Object.entries(legacyEquipment)) {
          if (key.endsWith("Id") || key.endsWith("Type") || key.startsWith("new") && !key.endsWith("Gps")) {
            assert.equal(html.includes(String(value)),
              key.includes("System") ? visibility.showSystem : visibility.showModule, key);
          }
        }
        assert.match(html, />0<\/td>/, "zero readings are populated data");
        assert.equal(html.split("40,-74").length - 1, 1, "old GPS appears once");
        assert.equal(html.split("41,-75").length - 1, 1, "new GPS appears once");
        assert.deepEqual(legacyEquipment, original, "printing must not rewrite stored data");
      }
    }
  }
});

test("PDF omits empty sides and gives single populated columns the full width", () => {
  const visibility = getProjectEquipmentVisibility({ changeoutEquipmentType: "both" });
  for (const equipment of [
    { oldSystemReading: 0 },
    { oldModuleRead: 0 },
    { newSystemId: "NEW" },
    { newModuleType: "TYPE" },
  ]) {
    const html = buildWorkOrderEquipmentHtml(equipment, visibility);
    assert.equal((html.match(/<h3 /g) || []).length, 1);
    assert.match(html, /width: 100%; vertical-align: top/);
    assert.doesNotMatch(html, /width: 50%/);
    assert.doesNotMatch(html, /padding-(left|right): 10px/);
  }
  assert.equal(buildWorkOrderEquipmentHtml({}, visibility), "");
});

test("PDF preserves common GPS when the only equipment is hidden", () => {
  const visibility = getProjectEquipmentVisibility({ changeoutEquipmentType: "system" });
  const hidden = { oldModuleId: "HIDDEN", newModuleRead: 123, oldGps: "40,-74", newGps: "41,-75" };
  const html = buildWorkOrderEquipmentHtml(hidden, visibility);
  assert.doesNotMatch(html, /System|Module|HIDDEN|123/);
  assert.match(html, /Old Location/);
  assert.match(html, /New Location/);
  assert.match(html, /40,-74/);
  assert.match(html, /41,-75/);
  assert.equal(buildWorkOrderEquipmentHtml({ oldModuleId: "HIDDEN" }, visibility), "");
});

test("PDF GPS follows each visible side without blank columns or duplicates", () => {
  const html = buildWorkOrderEquipmentHtml({
    oldSystemId: "OLD", newModuleId: "NEW", oldGps: "40,-74", newGps: "41,-75",
  }, getProjectEquipmentVisibility({ changeoutEquipmentType: "both" }));
  assert.match(html, /Old System/);
  assert.match(html, /New Module/);
  assert.doesNotMatch(html, /New System|Old Module|Location|width: 50%/);
  assert.equal(html.split("40,-74").length - 1, 1);
  assert.equal(html.split("41,-75").length - 1, 1);
});

test("PDF equipment values cannot inject headings or markup", () => {
  const html = buildWorkOrderEquipmentHtml({ oldSystemId: "<h3>Module</h3>&\"'" },
    getProjectEquipmentVisibility({ changeoutEquipmentType: "system" }));
  assert.match(html, /&lt;h3&gt;Module&lt;\/h3&gt;&amp;&quot;&#39;/);
  assert.equal((html.match(/<h3 /g) || []).length, 1);
});
