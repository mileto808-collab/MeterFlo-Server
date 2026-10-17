import type { RoutePoint, RoutingStop } from "../../shared/workOrderRouting";

export interface Candidate {
  id: number; label: string; address: string; point: RoutePoint;
  scheduledAt: string | null; priority: number | null; subStatus: string | null;
}
export interface RoadLeg { seconds: number; meters: number }
type State = { order: number[]; remaining: number[]; time: number; late: number; lateCount: number; priority: number; travel: number };
const compare = (a: number[], b: number[]) => {
  for (let i=0;i<a.length;i++) if(a[i]!==b[i]) return a[i]-b[i];
  return 0;
};
/** Bounded beam search. All comparisons are lexicographic: appointments,
 * urgency, driving. No weighted travel saving can buy a missed appointment. */
export function optimizeStops(candidates: Candidate[], matrix: (RoadLeg | null)[][], departure: number, serviceMinutes: number, toleranceMinutes: number) {
  const n=candidates.length, service=serviceMinutes*60000, tolerance=toleranceMinutes*60000;
  if (!Number.isFinite(departure) || n>24) throw new Error("Invalid route planning bounds.");
  if (matrix.length!==n+1 || matrix.some(row=>row.length!==n+1)) throw new Error("Invalid travel matrix.");
  const appointments=candidates.map(c=>c.scheduledAt?Date.parse(c.scheduledAt):null);
  if(appointments.some(t=>t!==null&&!Number.isFinite(t))) throw new Error("Invalid appointment.");
  const ranks=[...new Set(candidates.filter(c=>c.priority!==null).map(c=>c.priority!))].sort((a,b)=>a-b);
  const urgency=candidates.map(c=>c.priority===null?0:ranks.length-ranks.indexOf(c.priority));
  let beam:State[]=[{order:[],remaining:candidates.map((_,i)=>i),time:departure,late:0,lateCount:0,priority:0,travel:0}];
  const score=(s:State) => {
    // Optimistic independent arrival lower bound keeps distant near-term
    // appointments competitive while building partial routes.
    const from=s.order.length?s.order[s.order.length-1]+1:0;
    let late=s.late,count=s.lateCount;
    for(const i of s.remaining) {
      const deadline=appointments[i], leg=matrix[from][i+1];
      if(deadline!==null&&leg) {const l=Math.max(0,s.time+leg.seconds*1000-deadline-tolerance);late+=l;if(l>0)count++;}
    }
    return [count,late,s.priority,s.travel,...s.order.map(i=>candidates[i].id)];
  };
  for(let depth=0;depth<n;depth++) {
    const next:State[]=[];
    for(const s of beam) {
      const from=s.order.length?s.order[s.order.length-1]+1:0;
      for(const i of s.remaining) {
        const leg=matrix[from][i+1];
        if(!leg||!Number.isFinite(leg.seconds)||leg.seconds<0)continue;
        const arrival=s.time+leg.seconds*1000, appointment=appointments[i];
        const lateness=appointment===null?0:Math.max(0,arrival-appointment-tolerance);
        next.push({order:[...s.order,i],remaining:s.remaining.filter(j=>j!==i),
          time:Math.max(arrival,appointment??arrival)+service,late:s.late+lateness,
          lateCount:s.lateCount+(lateness>0?1:0),priority:s.priority+urgency[i]*depth,travel:s.travel+leg.seconds});
      }
    }
    next.sort((a,b)=>compare(score(a),score(b)));
    beam=next.slice(0,128);
    if(!beam.length)throw new Error("No drivable route connects all selected stops. Review unreachable stops.");
  }
  const best=beam.sort((a,b)=>compare(score(a),score(b)))[0];
  let time=departure,from=0;
  const stops:RoutingStop[]=best.order.map(i=>{
    const leg=matrix[from][i+1]!,arrival=time+leg.seconds*1000;
    const serviceAt=Math.max(arrival,appointments[i]??arrival);
    time=serviceAt+service;from=i+1;
    return {...candidates[i],arrivalAt:new Date(arrival).toISOString(),serviceAt:new Date(serviceAt).toISOString(),
      departureAt:new Date(time).toISOString(),lateMinutes:appointments[i]===null?0:Math.max(0,(arrival-appointments[i]!-tolerance)/60000),
      travelSeconds:leg.seconds,travelMeters:leg.meters};
  });
  return stops;
}
