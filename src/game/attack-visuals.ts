import { Container, GlProgram, Graphics, Mesh, MeshGeometry, Shader } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import type { EvolutionId, GameSettings, ModuleId } from './types';

export type AttackVisualStyle = 'needle' | 'wing' | 'crystal' | 'electric' | 'seeker' | 'crescent' | 'note' | 'link' | 'pulse';
/** Mechanics and secondary damage provenance never depend on this presentation-only map. */
export const MODULE_VISUALS: Record<ModuleId, AttackVisualStyle> = {
  piercing: 'needle', wingShots: 'wing', precision: 'needle', shatter: 'crystal', chain: 'electric', prism: 'link',
  droneHoming: 'seeker', droneBurst: 'needle', slow: 'electric', division: 'seeker', intercept: 'pulse', orbitBlade: 'crescent',
  doubleDash: 'pulse', vent: 'pulse', reserveAmmo: 'crystal', graze: 'electric', revive: 'pulse', magnet: 'pulse',
  ricochet: 'electric', rearSpark: 'crystal', crossOrbit: 'link', returnWing: 'crescent', brakeField: 'pulse', dashEcho: 'pulse',
  pulseChamber: 'pulse', anchorStars: 'crystal', crescentMagazine: 'crescent', beamCircuit: 'link',
  droneSpotlight: 'link', droneNotes: 'note', dronePlectrum: 'crescent', droneConduit: 'link',
  decoyEcho: 'pulse', slipstream: 'wing', dashLane: 'link', counterPulse: 'pulse',
};
export const STYLE_COLORS: Record<AttackVisualStyle, number> = { needle: 0xaaf7ff, wing: 0x81d8ff, crystal: 0xc5ceff,
  electric: 0x93ffdf, seeker: 0xb9bcff, crescent: 0xa4aaff, note: 0xd2baff, link: 0x8cecff, pulse: 0xa6fff2 };
export const EVOLUTION_VISUALS: Record<EvolutionId, AttackVisualStyle> = {
  needleArray: 'needle', spiralBloom: 'crystal', forkNetwork: 'electric', triangleAssault: 'link', huntingReturn: 'crescent', echoTrail: 'pulse',
  sonicBreak: 'pulse', starCarpet: 'crystal', lunarCut: 'crescent', choralBeam: 'link', stageSpotlight: 'link', staticGarden: 'note',
  stringEcho: 'seeker', triangleHall: 'link', livingSpeaker: 'pulse', headwindFlame: 'wing', echoHighway: 'pulse', counterCurtain: 'pulse',
};

const vertex = `in vec2 aPosition; in vec2 aUV; out vec2 vUV;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
void main(){vUV=aUV; vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0); gl_Position=vec4(p.xy,0.0,1.0);}`;
const fragment = `precision highp float; in vec2 vUV; out vec4 finalColor;
uniform float uTime; uniform float uFade; uniform float uHostile; uniform float uMotion;
void main(){
 float y=abs(vUV.y-.5)*2.0;
 float core=1.0-smoothstep(.025,.16,y);
 float sheath=(1.0-smoothstep(.24,.98,y))*.24;
 float stream=pow(.5+.5*sin(vUV.x*94.0-uTime*32.0+y*8.0),6.0);
 float energy=core*.82+sheath+stream*(1.0-y)*.25*uMotion;
 vec3 color=mix(vec3(.24,.88,1.0),vec3(1.0,.35,.12),uHostile);
 color=mix(color,vec3(1.0),core*.86);
 float ends=smoothstep(0.0,.012,vUV.x)*(1.0-smoothstep(.96,1.0,vUV.x));
 float alpha=clamp(energy*uFade*ends,0.0,1.0); finalColor=vec4(color*alpha,alpha);
}`;
/** Finite pooled local beam meshes; one program/geometry, no full-screen postprocessing. */
export class AttackMaterials {
  readonly layer = new Container();
  private geometry = new MeshGeometry({ positions: new Float32Array([0, -.5, 1, -.5, 1, .5, 0, .5]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) });
  private program = GlProgram.from({ vertex, fragment, name: 'mafuyu-energy-flow' });
  private meshes: Mesh<MeshGeometry, Shader>[] = [];
  private used = 0;
  private glow = new GlowFilter({ distance: 7, outerStrength: 1.1, innerStrength: 0, color: 0x67eaff, quality: 0.1 });
  private muzzles: Graphics[] = [];
  private muzzleCount = 0;
  begin() { this.used = 0; this.muzzleCount = 0; }
  beam(x: number, y: number, angle: number, length: number, width: number, fade: number, hostile: boolean, time: number, settings: GameSettings) {
    if (settings.quality === 'low' || this.used >= 64 || fade <= 0) return;
    let mesh = this.meshes[this.used++];
    if (!mesh) {
      const shader = new Shader({ glProgram: this.program, resources: { energyUniforms: {
        uTime: { value: 0, type: 'f32' }, uFade: { value: 1, type: 'f32' },
        uHostile: { value: 0, type: 'f32' }, uMotion: { value: 1, type: 'f32' },
      } } });
      mesh = new Mesh({ geometry: this.geometry, shader }); mesh.blendMode = 'add';
      this.meshes.push(mesh); this.layer.addChild(mesh);
    }
    mesh.visible = true; mesh.position.set(x, y); mesh.rotation = angle; mesh.scale.set(length, width);
    const uniforms = mesh.shader!.resources.energyUniforms.uniforms;
    uniforms.uTime = settings.reducedMotion ? 0 : time; uniforms.uFade = fade; uniforms.uHostile = hostile ? 1 : 0; uniforms.uMotion = settings.reducedMotion ? 0 : 1;
    if (!hostile && this.muzzleCount < 4 && settings.quality === 'high') {
      let muzzle = this.muzzles[this.muzzleCount++];
      if (!muzzle) { muzzle = new Graphics(); muzzle.filters = [this.glow]; this.layer.addChild(muzzle); this.muzzles.push(muzzle); }
      muzzle.visible = true; muzzle.position.set(x, y); muzzle.alpha = fade;
      muzzle.clear().circle(0, 0, Math.min(60, width * .55)).stroke({ color: 0xbcffff, width: 2 });
    }
  }
  end() { for (let i = this.used; i < this.meshes.length; i++) this.meshes[i].visible = false; for (let i = this.muzzleCount; i < this.muzzles.length; i++) this.muzzles[i].visible = false; }
  reset() { this.begin(); this.end(); }
  destroy() { for (const mesh of this.meshes) mesh.shader?.destroy(); this.layer.destroy({ children: true }); this.geometry.destroy(); this.glow.destroy(); }
}
