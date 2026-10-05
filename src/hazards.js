import {clamp} from './physics.js';

export const HAZARD_TYPES=['debris','oil','puddle','closure'];
const LANES=[-6.6,-2.2,2.2,6.6];

export function laneX(lane){return LANES[clamp(lane,0,LANES.length-1)]}

export function createHazards(world='akuma'){
 const hazards=[];
 for(let i=0;i<34;i++){
  const s=150+i*118+(i%3)*17;
  const lane=(i*7+(world==='pelagic'?1:0))%4;
  const roll=(i*13)%10;
  const type=roll<3?'debris':roll<6?'oil':roll<8?'puddle':'closure';
  hazards.push({
   id:`${world}-${i}`,type,s,lane,x:laneX(lane),
   width:type==='closure'?4.25:type==='debris'?.8:2.3,
   depth:type==='closure'?4.8:type==='debris'?1.1:3.8,
   severity:type==='closure'?.7:type==='debris'?.45:type==='puddle'?.3:.55,
   passed:false
  });
 }
 return hazards;
}

export function nearbyHazards(hazards,p,lookAhead=95){
 return hazards.filter(h=>h.s>=p.s-4&&h.s<=p.s+lookAhead).map(h=>({
  type:h.type,distance:Math.round(h.s-p.s),lane:h.lane,
  severity:h.severity,width:h.width
 }));
}

export function hazardAt(hazards,p){
 return hazards.find(h=>Math.abs(h.s-p.s)<h.depth*.5+1.2&&Math.abs(h.x-p.x)<h.width*.5);
}

export function surfaceGrip(hazards,p,weather){
 const h=hazardAt(hazards,p);
 if(!h)return 1;
 if(h.type==='oil')return weather==='rain'?.48:.62;
 if(h.type==='puddle')return weather==='rain'?.68:.86;
 return 1;
}
