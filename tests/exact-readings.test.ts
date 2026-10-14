import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { pool } from "../server/db";
import { createProjectSchema, migrateProjectSchema, getProjectWorkOrderStorage, backupProjectDatabase, restoreProjectDatabase } from "../server/projectDb";
import { exactReadingFields, withExactReadings } from "../shared/exact-readings";
import { buildCustomerPayload } from "../server/customerApiPayload";
import { validateCapturedReadings } from "../shared/reading-precision";

test("exact reading persistence, legacy compatibility, backup, reset and spreadsheet round trips", async () => {
  const schema = await createProjectSchema(`Exact ${randomUUID().replace(/-/g,"")}`,900001);
  const restoredSchema = await createProjectSchema(`Exact ${randomUUID().replace(/-/g,"")}`,900002);
  const store = getProjectWorkOrderStorage(schema);
  const actorId = randomUUID(), actor = `exact-fixture-${randomUUID()}`;
  try {
    await pool.query("INSERT INTO public.users(id,username,role) VALUES($1,$2,'user')",[actorId,actor]);
    const values = ["00001.001200","00000","00900719925474099312345.123456","00023.000000"];
    const input = Object.fromEntries(exactReadingFields.map(({key},i) => [key,values[i]]));
    const saved = await store.createWorkOrder({
      customerWoId:"EXACT-1",customerId:"FIXTURE",customerName:"Fixture",address:"Fixture",
      status:"Open",...input,
    } as any);
    let fetched = await store.getWorkOrder(saved.id);
    assert.ok(fetched);
    for (const {key,column} of exactReadingFields) {
      assert.equal((fetched as any)[`${key}Text`],input[key]);
      assert.equal((withExactReadings(fetched) as any)[key],input[key]);
      const raw = await pool.query(`SELECT ${column}::text numeric,${column}_text exact FROM "${schema}".work_orders WHERE id=$1`,[saved.id]);
      assert.equal(raw.rows[0].exact,input[key]);
      assert.ok(!raw.rows[0].numeric.startsWith("00"),"existing numeric storage still numeric");
    }
    assert.equal(typeof fetched.oldSystemReading,"number","camel numeric compatibility retained");
    await migrateProjectSchema(schema);
    await migrateProjectSchema(schema);
    await store.updateWorkOrder(saved.id,{notes:"Unrelated edit"} as any);
    await store.updateWorkOrder(saved.id,{oldSystemReading:1.0012} as any);
    await store.updateWorkOrder(saved.id,{oldModuleRead:Number(values[2])} as any);
    fetched = await store.getWorkOrder(saved.id);
    assert.equal(fetched?.oldSystemReadingText,"00001.001200","numeric legacy echo does not erase exact capture");
    assert.equal(fetched?.oldModuleReadText,values[2],"a rounded legacy numeric echo does not corrupt long readings");
    assert.deepEqual(validateCapturedReadings(input,{systemReadingDecimalPlaces:0,moduleReadingDecimalPlaces:0},fetched),[],
      "unchanged historic exact readings can survive a lowered limit");
    assert.deepEqual(validateCapturedReadings({newSystemReading:1.0012},
      {systemReadingDecimalPlaces:0,moduleReadingDecimalPlaces:0},
      {new_system_reading:"1.0012",new_system_reading_text:"00001.0012"}),[],
      "native snake-case baselines accept an unchanged legacy numeric echo");

    const payload = buildCustomerPayload(fetched as any,{id:900001,name:"Fixture"},"fixture-delivery");
    assert.equal(payload.oldSystemReading,values[0]);
    assert.equal(payload.oldMeterReading,values[0]);
    assert.equal(payload.oldModuleReading,values[2]);
    const raw = (await pool.query(`SELECT * FROM "${schema}".work_orders WHERE id=$1`,[saved.id])).rows[0];
    assert.equal(withExactReadings(raw).old_module_read,values[2],"mobile snake-case download preserves exact string");

    const backup = await backupProjectDatabase(schema);
    assert.equal(backup.workOrders[0].oldModuleRead,values[2]);
    const restored = await restoreProjectDatabase(restoredSchema,backup);
    assert.equal(restored.restored,1);
    assert.deepEqual(restored.errors,[]);
    const copy = (await getProjectWorkOrderStorage(restoredSchema).getWorkOrders())[0];
    assert.equal(copy.oldSystemReadingText,values[0]);
    assert.equal(copy.oldModuleReadText,values[2]);
    const sheet = XLSX.utils.json_to_sheet([{Reading:copy.oldModuleReadText}]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,sheet,"Readings");
    const reloaded = XLSX.read(XLSX.write(book,{type:"buffer",bookType:"xlsx"}),{type:"buffer"});
    assert.equal(reloaded.Sheets.Readings.A2.t,"s");
    assert.equal(reloaded.Sheets.Readings.A2.v,values[2],"spreadsheet reading is text, not a rounded number");

    await store.updateWorkOrder(saved.id,{newSystemReading:"00001.0012",status:"Completed"} as any);
    await store.resetCompletedWorkOrder(saved.id,-900001,{assignment:"keep",capturedData:"clear",attachments:"keep"},actor,
      async () => ({removedNames:[],commit:async () => {},rollback:async () => {}}));
    fetched = await store.getWorkOrder(saved.id);
    assert.equal(fetched?.newSystemReading,null);
    assert.equal(fetched?.newSystemReadingText,null);
    assert.equal(fetched?.oldSystemReadingText,values[0]);
    assert.ok(fetched?.notes?.includes("00001.0012"),"reset Notes retain the prior exact capture");
    await store.updateWorkOrder(saved.id,{newModuleRead:"0000.000001"} as any);
    await pool.query(`UPDATE "${schema}".work_orders SET new_module_read=2 WHERE id=$1`,[saved.id]);
    fetched = await store.getWorkOrder(saved.id);
    assert.equal(fetched?.newModuleReadText,"2","direct numeric changes invalidate stale captured labels");
    await store.updateWorkOrder(saved.id,{oldSystemReading:""} as any);
    assert.equal((await store.getWorkOrder(saved.id))?.oldSystemReadingText,null);
    await pool.query(`UPDATE "${schema}".work_orders SET old_module_read_text=NULL WHERE id=$1`,[saved.id]);
    assert.equal((await store.getWorkOrder(saved.id))?.oldModuleReadText,values[2].replace(/^0+(?=\d)/,""),
      "numeric-only history retains every database digit without inventing leading zeros");
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.query(`DROP SCHEMA "${restoredSchema}" CASCADE`);
    await pool.query("DELETE FROM public.users WHERE id=$1",[actorId]);
    await pool.end();
  }
});
