import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, itemSchema, warehouseSchema } from "../shared/inventory";
import { inventoryAuditEntity, inventoryAuditReferences, readableAuditEvents } from "../server/auditReadModel";
import { pool } from "../server/db";
import { auditCsv, auditWorkbook, auditPrintHtml } from "../client/src/lib/audit-export";

after(() => pool.end());
const itemId = "10000000-0000-4000-8000-000000000001";
const countId = "10000000-0000-4000-8000-000000000002";
const operationId = "10000000-0000-4000-8000-000000000003";
const state = emptyInventory();
state.items = [itemSchema.parse({id:itemId,sku:"00001",name:"<Meter>",tracking:"serialized"})];
state.warehouses = [warehouseSchema.parse({id:"w",code:"MAIN",name:"Main warehouse",type:"physical",address:"Test"})];
state.counts = [{id:countId,warehouseId:"w",snapshot:[],status:"open"}];
const row = {
  id:operationId,sequence:"123",occurred_at:"2026-10-16T00:00:00Z",actor_id:"u",actor_label:"=Inspector",
  actor_kind:"user",source:"web",action:"inventory.countSaveDraft",entity_type:"inventory",
  entity_id:operationId,entity_label:operationId,project_id:4,project_label:null,current_project_label:"<Project>",
  operation_id:operationId,outcome:"success",resolved_entity:"Count #1",
  changes:[{field:`counts/${countId}`,before:null,after:{id:countId,itemId,serials:["00001",operationId]}}],
  metadata:{reference:countId},
};
const client:any = {query:async(sql:string) => ({rows:sql.includes("inventory_state") ? [{project_id:4,state}] :
  [{operation_id:operationId,project_id:4,first:"121"}]})};
test("inventory references and new captured labels use stable business identities", () => {
  const before = structuredClone(state);
  assert.equal(inventoryAuditReferences(state).get(itemId),"00001 · <Meter>");
  assert.equal(inventoryAuditEntity(state,row.changes,operationId),"Count #1");
  assert.deepEqual(state,before);
});
test("readable view retains immutable raw evidence and never changes scanned serials",async() => {
  const before = structuredClone(row);
  const [event] = await readableAuditEvents(client,[row]);
  assert.equal(event.eventReference,"Audit #123");
  assert.equal(event.operationReference,"Operation #121");
  assert.equal(event.entityReference,"Count #1");
  assert.equal(event.projectReference,"<Project>");
  assert.equal(event.displayChanges?.[0].field,"Count #1");
  assert.equal((event.displayChanges?.[0].after as any).id,"Count #1");
  assert.equal((event.displayChanges?.[0].after as any).itemId,"00001 · <Meter>");
  assert.deepEqual((event.displayChanges?.[0].after as any).serials,["00001",operationId]);
  assert.equal(event.displayMetadata?.reference,"Count #1");
  assert.deepEqual(event.changes,row.changes);
  assert.deepEqual(row,before);
});
test("audit exports use readable references, preserve text and escape HTML/formulas",async() => {
  const [event] = await readableAuditEvents(client,[row]);
  const context = {timezone:"UTC",scope:"Filtered events"};
  const csv = auditCsv([event],context);
  assert.ok(csv.includes("Audit #123"));
  assert.ok(csv.includes("'=Inspector"));
  assert.ok(csv.includes("Count #1"));
  const html = auditPrintHtml([event],context);
  assert.ok(html.includes("&lt;Project&gt;") && !html.includes("<Meter>"));
  const book = await auditWorkbook([event],context);
  assert.ok(book.SheetNames.length);
  const sheet = book.Sheets[book.SheetNames[0]];
  assert.equal(sheet["C2"].v,"=Inspector");
  assert.equal(sheet["C2"].t,"s");
  assert.equal(sheet["C2"].f,undefined);
});
