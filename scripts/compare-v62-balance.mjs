import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
// Prepare baseline with: git archive -o .tmp/v62-baseline-src.zip 7b75fca src
// then extract that archive to .tmp/v62-baseline-src before running this script.
const loader = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true } });
const reports = [];
try {
 for(const [version,path] of [['baseline-7b75fca','/.tmp/v62-baseline-src/src/game/simulation.ts'],['v6.2','/src/game/simulation.ts']]) {
  const {GameSimulation}=await loader.ssrLoadModule(path);
  for(const difficulty of ['normal','hard']) for(const season of ['s1','s2']) for(let card=0;card<6;card++) {
   const sim=new GameSimulation(62001,difficulty);sim.reset('story',62001,difficulty,{difficulty});
   const s=sim.state,p=s.player;p.level=7;p.invincible=0;
   s.build.modules=['precision','droneBurst','doubleDash','prism'];s.build.ranks={precision:2,droneBurst:2,doubleDash:2,prism:2};sim.refreshBuild();
   const boss=sim.spawnEnemy('boss',2000,1780,season==='s1'?'s1:mafuyu':'s2:final');boss.spell.cardIndex=card;
   const hp=(season==='s1'?[1200,1300,1400,1500,1700,1900]:[2600,2900,3100,3500,3800,4100])[card]*(difficulty==='hard'?1.35:1);
   boss.hp=boss.maxHp=Math.round(hp);p.x=p.prevX=2000;p.y=p.prevY=2220;s.pickups.push({id:999999,type:'support',value:3,x:p.x,y:p.y,age:0});
   let dashes=0,damage=0,enemyShots=0,finished=false;const sources={};let move={x:1,y:0};
   for(let tick=0;tick<80*60;tick++) {
    if(s.status!=='playing')break;
    if(tick%12===0) {
     const old=move;let best=Infinity;
     for(let i=0;i<24;i++) {
      const x=Math.cos(i*Math.PI/12),y=Math.sin(i*Math.PI/12),future={x:p.x+x*120,y:p.y+y*120},a=s.arena;
      let cost=Math.abs(Math.hypot(future.x-boss.x,future.y-boss.y)-500)*.1 + (1-x*old.x-y*old.y)*3;
      if(future.x<a.x+30||future.x>a.x+a.width-30||future.y<a.y+30||future.y>a.y+a.height-30)cost+=10000;
      if(Math.hypot(future.x-boss.x-boss.vx*.4,future.y-boss.y-boss.vy*.4)<boss.radius+60)cost+=5000;
      for(const b of s.bullets)if(b.owner==='enemy') {const d=Math.hypot(future.x-b.x-b.vx*.4,future.y-b.y-b.vy*.4)-b.radius-7;cost+=d<12?1000:Math.exp(-d/22)*40;}
      if(cost<best){best=cost;move={x,y};}
     }
    }
    const threat=s.bullets.some(b=>b.owner==='enemy'&&Math.hypot(b.x-p.x,b.y-p.y)<55);
    const before=boss.hp;
    const events=sim.step({moveX:move.x,moveY:move.y,aimX:boss.x,aimY:boss.y,shoot:true,bomb:false,dash:threat&&p.dashCooldown<=0});
    for(const e of events){if(e.type==='damage')sources[e.damageSource??'unknown']=(sources[e.damageSource??'unknown']??0)+1;if(e.type==='dash')dashes++;if(e.type==='enemyShot')enemyShots++;}
    finished=boss.spell.cardIndex!==card||boss.hp<=0;
    damage+=finished?before:Math.max(0,before-boss.hp);if(finished)break;
   }
   reports.push({version,difficulty,season,card:card+1,elapsed:s.elapsed,cardCleared:finished,dps:damage/Math.max(1,s.elapsed),damageSources:sources,dashes,bombsUsed:3-p.bombs,enemyShots,finalHp:p.hp});
  }
 }
 await writeFile('docs/validation/v6.2-balance-comparison.json',JSON.stringify({seed:62001,configuration:'Lv7, three companions, precision/droneBurst/doubleDash/prism rankII. Identical 200ms steering cadence with bullet/body forecasts, held fire, reactive dash, no bombs. 80s maximum per card or real death. This limited controller is a comparison, not a human or reachability acceptance test.',reports},null,2));
 console.log(JSON.stringify({samples:reports.length,baselineClears:reports.filter(r=>r.version.startsWith('baseline')&&r.cardCleared).length,currentClears:reports.filter(r=>r.version==='v6.2'&&r.cardCleared).length}));
}finally{await loader.close();}
