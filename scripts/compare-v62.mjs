import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] });
const reports = [];
try {
 for (const [version, port] of [['baseline-7b75fca', 5188], ['v6.2', 5189]]) for (const scenario of ['stress', 'full-build', 'spell']) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
   window.__gpuCounts = { draws: 0, resources: {}, peaks: {} };
   const p = window.WebGL2RenderingContext.prototype, c = window.__gpuCounts;
   for (const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']) { const original=p[name];p[name]=function(...args){c.draws++;return original.apply(this,args);}; }
   for (const kind of ['Buffer','Texture','Program','Shader','Framebuffer']) {
    c.resources[kind]=0;c.peaks[kind]=0;
    for (const action of ['create','delete']) { const name=action+kind, original=p[name];p[name]=function(...args){const result=original.apply(this,args);if(action==='create'&&result){c.resources[kind]++;c.peaks[kind]=Math.max(c.peaks[kind],c.resources[kind]);}else if(action==='delete'&&args[0])c.resources[kind]--;return result;}; }
   }
  });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`);await page.getByRole('button',{name:'开始游戏',exact:true}).waitFor();
  await page.evaluate(scenario => {
   const d=window.__MAFUYU_DEBUG__;d.settings({quality:'medium'});
   if(scenario==='stress')d.stress();
   else {
    const modules=['piercing','wingShots','precision','shatter','chain','prism','droneHoming','droneBurst','slow','division','intercept','orbitBlade','doubleDash','vent','reserveAmmo','graze','revive','magnet','ricochet','rearSpark','crossOrbit','returnWing','brakeField','dashEcho','pulseChamber','anchorStars','crescentMagazine','beamCircuit','droneSpotlight','droneNotes','dronePlectrum','droneConduit','decoyEcho','slipstream','dashLane','counterPulse'];
    const evolutions=['needleArray','spiralBloom','forkNetwork','triangleAssault','huntingReturn','echoTrail','sonicBreak','starCarpet','lunarCut','choralBeam','stageSpotlight','staticGarden','stringEcho','triangleHall','livingSpeaker','headwindFlame','echoHighway','counterCurtain'];
    d.practice({season:'s2',cardIndex:5,modules:scenario==='full-build'?modules:[],ranks:Object.fromEntries(modules.map(id=>[id,20])),evolutions:scenario==='full-build'?evolutions:[]});
    const s=d.state();s.player.invincible=100;s.enemies.forEach(e=>{e.hp=e.maxHp=1e7;});
   }
  },scenario);
  if(scenario==='full-build'){const box=await page.locator('#game-host').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height*.25);await page.mouse.down();await page.keyboard.press('r');}
  await page.waitForTimeout(3000);
  const report=await page.evaluate(async()=>{
   const intervals=[],draws=[],snapshots=[];let previous=performance.now(),start=previous,lastStats=0;
   await new Promise(resolve=>{function tick(now){intervals.push(now-previous);previous=now;draws.push(window.__gpuCounts.draws);window.__gpuCounts.draws=0;
    if(now-lastStats>1000){snapshots.push(window.__MAFUYU_DEBUG__.snapshot().stats);lastStats=now;}
    if(now-start<15000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});
   const quantile=(values,p)=>{values=[...values].sort((a,b)=>a-b);return values[Math.min(values.length-1,Math.floor(values.length*p))];};
   const gl=document.querySelector('#game-host canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
   return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',frameMs:{p95:quantile(intervals,.95),p99:quantile(intervals,.99)},draws:{p50:quantile(draws,.5),p95:quantile(draws,.95)},resources:window.__gpuCounts,snapshots};
  });
  reports.push({version,scenario,errors,...report});console.log(version,scenario,report.frameMs,report.draws);await page.close();
 }
 await mkdir('docs/validation',{recursive:true});await writeFile('docs/validation/v6.2-performance-comparison.json',JSON.stringify({date:new Date().toISOString(),setup:'1920×1080, medium; 3s warmup + 15s sample, desktop Chromium D3D11. Full build rank20, invincible diagnostic player/large boss HP. Not a phone or integrated GPU test.',reports},null,2));
}finally{await browser.close();}
