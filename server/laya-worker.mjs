import {parentPort} from 'node:worker_threads';
try {
 const {Laya}=await import('@receptron/laya');
 const model=await Laya.load({...(process.env.LAYA_MODEL_DIR?{modelDir:process.env.LAYA_MODEL_DIR}:{}),executionProviders:['cpu'],sessionOptions:{intraOpNumThreads:2}});
 parentPort.postMessage({ready:true});
 parentPort.on('message',async({id,state})=>{
  try{
   const result=await model.systemOne(state,{
    tactic:{type:'choice',instructions:'Choose a safe rival racing tactic based on player condition. Never cause unavoidable collisions.',criteria:{race:'Hold normal racing line',overtake:'Pass player using an open adjacent lane',defend:'Defend a lane smoothly without contact',yield:'Give struggling or damaged player space',slipstream:'Tuck into the wake of the vehicle ahead before attempting a pass',block:'Take the line the player is moving toward, only against a healthy confident player',bait:'Occupy the clean lane beside an upcoming hazard'}},
    encounter:{type:'choice',instructions:'Choose challenge pacing. Favor recovery after damage and pressure only for confident fast riders.',criteria:{recover:'Reduce aggression and provide breathing room',balanced:'Normal competitive racing',pressure:'More assertive overtaking for a skilled player',duel:'One rival has been side by side with the player for a long time; focus the contest on that rival'}}
   });
   parentPort.postMessage({id,result:{tactic:result.answers.tactic.choice,encounter:result.answers.encounter.choice}});
  }catch{parentPort.postMessage({id,error:'Inference failed'})}
 });
}catch(error){parentPort.postMessage({error:error.message});process.exitCode=1}
