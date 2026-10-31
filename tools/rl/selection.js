// Keep the best ES mean on fixed validation seeds, never on changing training seeds.
// Final test seeds are separate: validation is model selection, not held-out evidence.
export function selectPolicy(current,theta,fitness,generation){
 if(!Number.isFinite(fitness))throw new Error('selection: fitness must be finite');
 if(current&&fitness<=current.fitness)return current;
 return {theta:Array.from(theta),fitness,generation};
}
