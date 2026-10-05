export const BIKES=[
{id:'nightblade',name:'KESTREL',inspired:'Original custom / H2-inspired tuning',era:'CC0 CHASSIS / VECTOR SPECIAL',hp:228,mass:238,torque:142,redline:14000,style:'sport',color:'#b8ff55',cylinders:4,ratios:[2.9,2.1,1.7,1.45,1.27,1.12],vmax:81.6,vair:105.1},
{id:'redline',name:'REDLINE 916',inspired:'Ducati 916',era:'ITALIAN / 1990s',hp:114,mass:198,torque:90,redline:11500,style:'sport',color:'#ff395d',cylinders:2,ratios:[2.47,1.76,1.4,1.18,1.04,.96],vmax:65.4,vair:97.1},
{id:'ronin',name:'RONIN',inspired:'Suzuki Hayabusa',era:'HYPERSPORT / ICON',hp:194,mass:264,torque:155,redline:11500,style:'hyper',color:'#e4a94c',cylinders:4,ratios:[2.6,1.94,1.52,1.29,1.14,1.04],vmax:78.6,vair:107.0},
{id:'ghost',name:'GHOST R1',inspired:'Yamaha YZF-R1',era:'CROSSPLANE / SUPERSPORT',hp:198,mass:201,torque:112,redline:14500,style:'sport',color:'#7687ff',cylinders:4,ratios:[2.6,2.05,1.7,1.48,1.3,1.16],vmax:76.3,vair:100.6},
{id:'outlaw',name:'OUTLAW',inspired:'Harley-Davidson Fat Boy',era:'V-TWIN / CRUISER',hp:90,mass:315,torque:160,redline:6500,style:'cruiser',color:'#d9e4e6',cylinders:2,ratios:[2.3,1.6,1.2,1,.85,.72],vmax:52.8,vair:107.8},
{id:'cafe',name:'CAFE ZERO',inspired:'Honda CB750',era:'FOUR-CYLINDER / CLASSIC',hp:68,mass:218,torque:60,redline:8500,style:'classic',color:'#36e6dc',cylinders:4,ratios:[2.5,1.7,1.3,1.1,.96,.86],vmax:51.2,vair:92.2}
];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function road(s){return 18*Math.sin(s/310)+9*Math.sin(s/137)}
export function slope(s){return 18/310*Math.cos(s/310)+9/137*Math.cos(s/137)}
export function curvature(s){return -18/(310*310)*Math.sin(s/310)-9/(137*137)*Math.sin(s/137)}
export function createState(){return {s:0,x:0,v:0,vx:0,lean:0,rpm:1300,gear:1,health:100,slip:0,pitch:0,accel:0,invulnerable:0,time:0,shift:0,y:0,vy:0,altTarget:0,flight:false,landing:false,flightUsed:false,energy:100,boosting:false,lift:0,surfaceGrip:1,landImpact:0,scraping:0}}
export function step(p,input,bike,setup,dt){
p.scraping=0;
const mass=bike.mass+78,wet=setup.weather==='rain';let mu=setup.tires==='rain'?(wet?.98:1.03):setup.tires==='slick'?(wet?.62:1.28):(wet?.8:1.12);mu*=setup.assist?1.1:1;mu*=clamp(p.surfaceGrip||1,.35,1);
const drive=3.5*setup.gearing,ratio=bike.ratios[p.gear-1]*drive;const wheelRPM=p.v/.32*60/(2*Math.PI);
p.rpm=Math.max(1300,wheelRPM*ratio);p.shift=Math.max(0,p.shift-dt);
if(p.shift===0){if(p.rpm>bike.redline*.87&&p.gear<6){p.gear++;p.shift=.16}else if(p.rpm<bike.redline*.34&&p.gear>1){p.gear--;p.shift=.16}}
const r=clamp(p.rpm/bike.redline,0,1.1);const torque=bike.torque*(.58+.42*Math.sin(Math.min(1,r)*Math.PI));
const engine=input.throttle&&r<1.02&&p.shift===0?torque*ratio*.9/.32:0;const drag=.5*1.225*(bike.style==='cruiser'?.68:.36)*p.v*p.v;
const rolling=p.v>0?mass*9.81*.015:0;const engineBrake=!input.throttle?Math.min(280,p.v*8):0;
const longitudinal=engine-(input.brake?mass*9.81*mu*.95:0)-drag-rolling-engineBrake;
p.accel=clamp(longitudinal/mass,-mu*9.81,mu*9.81);p.v=Math.max(0,p.v+p.accel*dt);
const desired=input.steer*Math.min(5.8,p.v*.21);const lateral=(desired-p.vx)*3-curvature(p.s)*p.v*p.v;
const available=Math.sqrt(Math.max(1,(mu*9.81)**2-(p.accel*.55)**2));const lat=clamp(lateral,-available,available);
p.slip=Math.max(0,Math.abs(lateral)-available)/12;p.vx+=lat*dt;p.x+=p.vx*dt;
const leanTarget=-Math.atan2(lat+curvature(p.s)*p.v*p.v,9.81);p.lean+=(clamp(leanTarget,-1,1)-p.lean)*(1-Math.exp(-dt*7));
p.pitch+=(clamp(-p.accel*.012,-.10,.15)-p.pitch)*(1-Math.exp(-dt*9));p.s+=p.v*dt;p.time+=dt;p.invulnerable=Math.max(0,p.invulnerable-dt);
if(Math.abs(p.x)>8.4){p.x=clamp(p.x,-8.4,8.4);p.vx*=-.3;p.scraping=1;if(p.v>5){p.health=Math.max(0,p.health-dt*p.v*.35);p.v=Math.max(0,p.v-dt*10)}}
return p;
}
export function impact(p,relativeSpeed){if(p.invulnerable>0)return false;p.health=Math.max(0,p.health-clamp(Math.abs(relativeSpeed)*1.1,9,44));p.v*=.55;p.vx*=-.5;p.invulnerable=1.25;return true}

// Stabilized VTOL simulation: gravity-compensating thrust plus damped altitude hold.
// This models a fictional powered hovercraft; it is not passive motorcycle flight.
export function toggleFlight(p){
  if(p.flight){p.flight=false;p.landing=true;p.altTarget=0;return 'LANDING / AUTOPILOT'}
  p.flight=true;p.landing=false;p.altTarget=Math.max(24,p.y||0);p.flightUsed=true;return 'VECTOR DRIVE / ENGAGED';
}
export function stepFlight(p,input,bike,setup,dt){
  const mass=bike.mass+110;const boosting=!!input.boost&&p.energy>1&&!p.landing;
  p.boosting=boosting;p.energy=clamp(p.energy+(boosting?-24:10)*dt,0,100);
  const density=Math.max(.7,1.225*(1-(p.y||0)/10000));
  const thrust=(input.throttle?1700+bike.torque*8:260)*(boosting?1.7:1);
  const drag=.5*density*.42*p.v*p.v;
  p.accel=(thrust-drag)/mass-(input.brake?11:0);
  if(p.landing&&p.v>23)p.accel-=8;
  p.v=Math.max(0,p.v+clamp(p.accel,-16,15)*dt);
  const sideTarget=p.landing?clamp(-p.x*2,-8,8):input.steer*(9+p.v*.11);
  const sideAcceleration=clamp((sideTarget-p.vx)*2.3,-15,15);
  p.vx+=sideAcceleration*dt;p.x+=p.vx*dt;
  if(p.landing)p.altTarget=0;
  else p.altTarget=clamp(p.altTarget+(input.climb||0)*13*dt,4,95);
  const hoverAcceleration=clamp((p.altTarget-p.y)*3.6-p.vy*3.3,-7.5,11.5);
  // Gravity is explicitly balanced by the rotor controller (net acceleration above).
  p.lift=mass*(9.81+hoverAcceleration);p.vy+=hoverAcceleration*dt;p.y+=p.vy*dt;
  p.landImpact*=.5;if(p.y<0){p.landImpact=Math.abs(p.vy);p.y=0;p.vy=0}
  if(p.landing&&p.y<.16&&Math.abs(p.vy)<1.2){p.y=0;p.vy=0;p.landing=false;p.altTarget=0;p.vx*=.4;p.gear=2}
  p.lean+=(clamp(-Math.atan2(sideAcceleration,9.81),-.85,.85)-p.lean)*(1-Math.exp(-dt*5));
  p.pitch+=(clamp(-p.accel*.018-p.vy*.013,-.25,.20)-p.pitch)*(1-Math.exp(-dt*4));
  p.s+=p.v*dt;p.time+=dt;p.rpm=2000+Math.min(1,p.v/100)*bike.redline*.65;p.gear=1;p.slip=0;
  p.invulnerable=Math.max(0,p.invulnerable-dt);
  if(Math.abs(p.x)>34){p.x=clamp(p.x,-34,34);p.vx*=-.3;p.health=Math.max(0,p.health-dt*3)}
  return p;
}
export function stepVehicle(p,input,bike,setup,dt){
  if(p.flight||p.landing)return stepFlight(p,input,bike,setup,dt);
  p.energy=clamp(p.energy+10*dt,0,100);p.boosting=false;return step(p,input,bike,setup,dt);
}
