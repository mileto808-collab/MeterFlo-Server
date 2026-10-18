import test from "node:test";
import assert from "node:assert/strict";
import { regenerateDispatch } from "../server/routing/regenerateDispatch";
import { RoutingError, type RoutingService } from "../server/routing/providers";
import type { StoredDispatch } from "../server/routing/dispatchStore";

const dispatch:StoredDispatch={
  id:"9181c071-d186-46b0-b822-f00dd3bbe4ed",plannerId:"planner",
  route:{projectId:1,assigneeId:"technician",originAddress:"Warehouse address",
    scopeIds:[4,2],fingerprint:"a".repeat(64),configurationRevision:"b".repeat(64),
    addressReviewVersion:1,assignmentRoutingVersion:1,
    departureAt:"2026-10-18T12:00:00.000Z",expiresAt:"2026-10-18T16:00:00.000Z",
    serviceMinutes:30,toleranceMinutes:10},
};
const orders=[
  {id:2,address:"Second property",assignedUserId:"technician",status:"Scheduled",serviceDurationMinutes:20},
  {id:4,address:"First property",assignedUserId:"technician",status:"Scheduled",appointmentWindowStart:"2026-10-18T12:15:00Z",
    appointmentWindowEnd:"2026-10-18T12:45:00Z"},
];
const provider:RoutingService={
  geocode:async address=>({lat:address==="First property"?40:41,lng:-105,
    addressMatch:{formatted:address,street:address}}),
  // A newly optimized route would favor the second stop. Recovery must not
  // silently replace the business sequence that dispatch actually sent.
  matrix:async()=>[
    [{seconds:0,meters:0},{seconds:60,meters:1000},{seconds:1,meters:10}],
    [{seconds:60,meters:1000},{seconds:0,meters:0},{seconds:60,meters:1000}],
    [{seconds:60,meters:1000},{seconds:1,meters:10},{seconds:0,meters:0}],
  ],
  geometry:async points=>points,
};

test("regeneration preserves sent sequence, expiry, windows and per-stop duration without changing work orders",async()=>{
  const before=structuredClone(orders);
  const {route,reviews}=await regenerateDispatch(dispatch,orders,[],{defaultServiceMinutes:30},
    "Technician","geoapify",provider,"technician",[]);
  assert.equal(reviews,undefined);
  assert.ok(route);
  assert.deepEqual(route.scopeIds,[4,2]);
  assert.deepEqual(route.stops.map(s=>s.id),[4,2]);
  assert.deepEqual(route.geometry,[route.origin,...route.stops.map(s=>s.point)]);
  assert.equal(route.expiresAt,dispatch.route.expiresAt);
  assert.equal(route.departureAt,dispatch.route.departureAt);
  assert.equal(route.stops[0].waitingMinutes,14);
  assert.equal(route.stops[0].appointmentSource,"window");
  assert.equal(route.stops[0].durationSource,"project");
  assert.equal(route.stops[1].serviceDurationMinutes,20);
  assert.equal(route.stops[1].durationSource,"work-order");
  assert.equal(route.totalTravelSeconds,120);
  assert.deepEqual(orders,before);
});

test("a newly unreachable dispatched leg fails explicitly instead of dropping or reordering the stop",async()=>{
  let geometryCalls=0;
  await assert.rejects(regenerateDispatch(dispatch,orders,[],{},
    "Technician","geoapify",{...provider,
      matrix:async()=>[[null,{seconds:60,meters:100},null],[null,null,null],[null,{seconds:1,meters:1},null]],
      geometry:async points=>{geometryCalls++;return points;},
    },"technician",[]),
  (error:unknown)=>error instanceof RoutingError&&error.status===422);
  assert.equal(geometryCalls,0);
});
