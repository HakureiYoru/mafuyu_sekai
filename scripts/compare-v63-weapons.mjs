import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
// Export `git archive a6d2fc7 src` under .tmp/v63-baseline-src before running.
const loader=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true}});const reports=[];
try {
for(const [version,path] of [['a6d2fc7','/.tmp/v63-baseline-src/src/game/simulation.ts'],['v6.3','/src/game/simulation.ts']]) {
const {GameSimulation}=await loader.ssrLoadModule(path);
for(const level of [4,7,10])for(const kind of ['main','wings','drones','choir']) {
const sim=new GameSimulation(63001);const s=sim.state,p=s.player;p.level=level;p.invincible=100;s.spawnTimer=1000;
const modules=kind==='main'?['precision','piercing']:kind==='wings'?['wingShots','precision','piercing']:kind==='drones'?['droneBurst','droneHoming','division']:['droneSpotlight','droneConduit','division'];
s.build.modules=modules;s.build.ranks=Object.fromEntries(modules.map(id=>[id,3]));sim.refreshBuild();
if(kind==='drones'||kind==='choir')s.pickups.push({id:99001,type:'support',value:3,x:p.x,y:p.y,age:0});
const target=sim.spawnEnemy('basic',p.x+300,p.y);target.hp=target.maxHp=1e7;target.radius=55;target.speed=0;
let heatStop=false;const bySource={};let dmg=0;
for(let i=0;i<20*60;i++) {
if(p.heat>=85)heatStop=true;if(p.heat<=35)heatStop=false;
const events=sim.step({moveX:0,moveY:0,aimX:target.x,aimY:target.y,shoot:!heatStop,focus:true,dash:false,bomb:false});
for(const e of events)if(e.type==='hit'&&e.targetId===target.id){bySource[e.text??'hit']=(bySource[e.text??'hit']??0)+(e.amount??0);}
}dmg=1e7-target.hp;reports.push({version,level,kind,damage:dmg,dps:dmg/20,heat:p.heat,elapsed:s.elapsed});
}}
await writeFile('docs/validation/v6.3-weapon-comparison.json',JSON.stringify({setup:'Identical seed 63001; rank III; 20 simulation seconds, stationary radius55 target at range300, held focus, 85/35 heat cycle; three companions only for drones/choir. Effective damage including misses/cooldowns; diagnostic target, not a full-run or human balance verdict.',reports},null,2));console.log(reports);
}finally{await loader.close();}
