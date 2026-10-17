import test from "node:test";
import assert from "node:assert/strict";
import { optimizeStops, type Candidate } from "../server/routing/optimizer";
import { importedVisitScheduling, mapSqlImportRow, validateVisitScheduling } from "../shared/visitScheduling";
import { readFile } from "node:fs/promises";
import { isoFromZonedInput, formatProjectTimestamp } from "../client/src/lib/project-scheduling-time";
import { mapImportRecord } from "../server/apiImportFetch";

const departure = Date.parse("2026-10-17T14:00:00Z");
const candidates = (values: Partial<Candidate>[]): Candidate[] => values.map((v, i) => ({
  id: i + 1, label: `WO-${i+1}`, address: "fixture", point: { lat: 40, lng: -105 },
  scheduledAt: null, priority: null, subStatus: null, ...v,
}));
const matrix = (n: number) => Array.from({length:n+1},(_,i)=>Array.from({length:n+1},(_,j)=>({seconds:i===j?0:60,meters:100})));
test("explicit windows protect service start before timestamp appointments and priority zero", () => {
  const stops = optimizeStops(candidates([
    { priority: 0, scheduledAt: "2026-10-17T14:02:00Z" },
    { priority: 5, appointmentWindowStart: "2026-10-17T14:02:00Z", appointmentWindowEnd: "2026-10-17T14:03:00Z" },
  ]),matrix(2),departure,30,60);
  assert.deepEqual(stops.map(s=>s.id),[2,1]);
  assert.equal(stops[0].waitingMinutes,1);
  assert.equal(stops[0].serviceAt,"2026-10-17T14:02:00.000Z");
  assert.equal(stops[0].departureAt,"2026-10-17T14:32:00.000Z","Visit need not finish inside a service-start window");
  assert.equal(stops[0].lateMinutes,0);
});
test("impossible windows report exact lateness without timestamp tolerance and retain original appointment", () => {
  const [stop] = optimizeStops(candidates([{
    scheduledAt:"2026-10-17T16:00:00Z",appointmentWindowStart:"2026-10-17T13:00:00Z",appointmentWindowEnd:"2026-10-17T13:30:00Z",
  }]),matrix(1),departure,30,60);
  assert.equal(stop.lateMinutes,31);
  assert.equal(stop.appointmentSource,"window");
  assert.equal(stop.scheduledAt,"2026-10-17T16:00:00Z");
});
test("mixed visit durations propagate into downstream arrivals with provenance", () => {
  const stops = optimizeStops(candidates([{priority:0,serviceDurationMinutes:90},{priority:1,serviceDurationMinutes:5},{priority:null}]),matrix(3),departure,30,60);
  assert.deepEqual(stops.map(s=>s.serviceDurationMinutes),[90,5,30]);
  assert.equal(stops[1].arrivalAt,"2026-10-17T15:32:00.000Z");
  assert.equal(stops[2].arrivalAt,"2026-10-17T15:38:00.000Z");
  assert.deepEqual(stops.map(s=>s.durationSource),["work-order","work-order","route"]);
});
test("null fields preserve point appointments and caller defaults", () => {
  const [stop] = optimizeStops(candidates([{scheduledAt:"2026-10-17T14:15:00Z",serviceDurationMinutes:null,appointmentWindowStart:null,appointmentWindowEnd:null}]),matrix(1),departure,45,10);
  assert.equal(stop.serviceAt,"2026-10-17T14:15:00.000Z");
  assert.equal(stop.departureAt,"2026-10-17T15:00:00.000Z");
  assert.equal(stop.appointmentSource,"scheduled");
  assert.equal(stop.waitingMinutes,14);
});
test("invalid windows, offsets and durations fail explicitly; partial updates validate merged state", () => {
  for (const data of [
    {serviceDurationMinutes:0},{serviceDurationMinutes:481},{serviceDurationMinutes:2.5},
    {appointmentWindowStart:"2026-10-17T10:00:00"},
    {appointmentWindowStart:"2026-10-17T10:00:00Z",appointmentWindowEnd:null},
    {appointmentWindowStart:"2026-10-17T11:00:00Z",appointmentWindowEnd:"2026-10-17T10:00:00Z"},
  ]) assert.throws(()=>validateVisitScheduling(data));
  assert.deepEqual(validateVisitScheduling({serviceDurationMinutes:null,appointmentWindowStart:null,appointmentWindowEnd:null}),
    {serviceDurationMinutes:null,appointmentWindowStart:null,appointmentWindowEnd:null});
  assert.equal(importedVisitScheduling({serviceDurationMinutes:"30"}).serviceDurationMinutes,30);
});
test("project local time rejects DST gaps and folds; timestamps with offsets distinguish repeated hours", () => {
  assert.throws(()=>isoFromZonedInput("2026-03-08T02:30","America/Denver"),/does not exist/);
  assert.throws(()=>isoFromZonedInput("2026-11-01T01:30","America/Denver"),/occurs twice/);
  assert.equal(isoFromZonedInput("2026-10-17T08:30","America/Denver"),"2026-10-17T14:30:00.000Z");
  assert.ok(formatProjectTimestamp("2026-10-17T14:30:00Z","America/Denver").includes("8:30"));
  const [stop] = optimizeStops(candidates([{appointmentWindowStart:"2026-11-01T01:30:00-06:00",appointmentWindowEnd:"2026-11-01T01:30:00-07:00"}]),matrix(1),Date.parse("2026-11-01T07:00:00Z"),30,60);
  assert.equal(stop.serviceAt,"2026-11-01T07:30:00.000Z");
  assert.equal(stop.waitingMinutes,29);
});
test("customer API import validates durations and explicit ISO windows", () => {
  const rules={services:["Water"],statuses:["Open"],systems:[],modules:[],openStatus:"Open"};
  const config={fieldMapping:{id:"customerWoId",customer:"customerId",name:"customerName",address:"address",service:"serviceType",duration:"serviceDurationMinutes",start:"appointmentWindowStart",end:"appointmentWindowEnd"}} as any;
  const record={id:"V1",customer:"C1",name:"fixture",address:"fixture",service:"Water",duration:"30",start:"2026-10-17T08:00:00-06:00",end:"2026-10-17T09:00:00-06:00"};
  assert.deepEqual(mapImportRecord(record,config,rules).errors,[]);
  assert.ok(mapImportRecord({...record,duration:"0"},config,rules).errors.length);
  assert.ok(mapImportRecord({...record,end:"2026-10-17T09:00:00"},config,rules).errors.length);
});
test("manual SQL path uses normalized numeric-text scheduling fields before create and update", async () => {
  const mapping={duration:"serviceDurationMinutes",start:"appointmentWindowStart",end:"appointmentWindowEnd"};
  const row={duration:"45",start:"2026-10-17T08:00:00-06:00",end:"2026-10-17T09:00:00-06:00"};
  assert.equal(mapSqlImportRow(row,mapping).serviceDurationMinutes,45);
  assert.throws(()=>mapSqlImportRow({...row,duration:"0"},mapping));
  assert.throws(()=>mapSqlImportRow({...row,end:"2026-10-17T09:00:00"},mapping));
  const routes=await readFile(new URL("../server/routes.ts",import.meta.url),"utf8");
  const manual=routes.slice(routes.indexOf('app.post("/api/import-configs/:id/run"'));
  assert.match(manual,/const mappedData = mapSqlImportRow\(row, columnMapping\)/);
  assert.ok(manual.indexOf("mapSqlImportRow(row, columnMapping)")<manual.indexOf("if (existingWo)"));
});
