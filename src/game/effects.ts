import { BitmapFontManager, BitmapText, Container, Sprite, Text, Texture, type BitmapFont } from 'pixi.js';
import { QUALITY } from './config';
import { TAU } from './math';
import { MODULES } from './upgrades';
import type { CombatEvent, GameSettings } from './types';

export interface EffectTextures { glow: Texture; spark: Texture; ring: Texture; player: Texture }
interface Particle {
  sprite: Sprite; x: number; y: number; vx: number; vy: number; life: number; total: number;
  startSize: number; endSize: number; stretch: number; spin: number; opacity: number; damping: number; priority: number;
}
interface FloatLabel { label: Text | BitmapText; life: number; total: number; x: number; y: number; amount: number; pending: number; commit: number; target: number | null; priority: number; key: string | null }
const damageText = (amount: number) => `${Number(amount.toFixed(1))}`;
export const EFFECT_NUMBER_FONT = 'MafuyuCombatNumbers';
export const EFFECT_NUMBER_CHARS = [...new Set(Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '−血药恢复共鸣经验符卡击破子机接入第波炸弹已满额转为换补给')].join('');
const numberCharacters = new Set(EFFECT_NUMBER_CHARS);
let numberFont: BitmapFont | undefined, numberFontUsers = 0;
/** Public Pixi font installation; one finite atlas shared by numeric labels and renderer instances. */
export function retainEffectNumberFont(): () => void {
  if (!numberFontUsers) numberFont = BitmapFontManager.install({ name: EFFECT_NUMBER_FONT, chars: EFFECT_NUMBER_CHARS,
    style: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 26, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x111427, width: 4 } },
    resolution: 1.5, padding: 4, skipKerning: true, dynamicFill: true });
  numberFontUsers++;
  let released = false;
  return () => { if (released) return; released = true; if (--numberFontUsers === 0) { BitmapFontManager.uninstall(EFFECT_NUMBER_FONT); numberFont = undefined; } };
}
// Numeric event prefixes above are closed; future unknown characters cannot grow the atlas.
const numberMessage = (message: string) => [...message].map(character => numberCharacters.has(character) ? character : '?').join('');

/** All randomness and clocks here are cosmetic; none feed back into the simulation. */
export class EffectSystem {
  readonly particles = new Container();
  readonly labels = new Container();
  private active: Particle[] = [];
  private free: Particle[] = [];
  private floats: FloatLabel[] = [];
  private floatFree: FloatLabel[] = [];
  private settings: GameSettings;
  private seed = 0x5eed1234;
  private stressBounds: { x: number; y: number } | null = null;
  private emissionPriority = 0;

  constructor(private readonly textures: EffectTextures, settings: GameSettings) {
    this.settings = settings;
    this.particles.eventMode = 'none';
    this.labels.eventMode = 'none';
  }

  private random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
    const cap = QUALITY[settings.quality].particles;
    while (this.active.length > cap) this.release(this.active.length - 1);
    for (let i = this.floats.length - 1; i >= 0; i--) {
      if (this.floats[i].amount > 0 && (settings.damageNumbers === 'off' || (settings.damageNumbers === 'important' && this.floats[i].priority === 0))) this.releaseLabel(i);
    }
  }

  private add(x: number, y: number, texture: Texture, color: number, life: number, size: number, endSize: number, vx = 0, vy = 0, opacity = 1, stretch = 1, angle = 0, additive = true) {
    const cap = QUALITY[this.settings.quality].particles;
    // Keep the total budget unchanged. Important outcomes can replace decoration at capacity.
    if (!this.stressBounds && this.emissionPriority === 0 && this.active.length >= cap - 24) return;
    if (this.active.length >= cap) {
      const replace = this.active.findIndex(particle => particle.priority < this.emissionPriority);
      if (replace < 0) return;
      this.release(replace);
    }
    let particle = this.free.pop();
    if (!particle) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      this.particles.addChild(sprite);
      particle = { sprite, x: 0, y: 0, vx: 0, vy: 0, life: 0, total: 0, startSize: 0, endSize: 0, stretch: 1, spin: 0, opacity: 1, damping: 3, priority: 0 };
    }
    const sprite = particle.sprite;
    sprite.visible = true; sprite.texture = texture; sprite.tint = color; sprite.rotation = angle;
    sprite.blendMode = additive ? 'add' : 'normal';
    Object.assign(particle, { x, y, vx, vy, life, total: life, startSize: size, endSize, opacity, stretch, spin: 0, damping: 3, priority: this.emissionPriority });
    sprite.position.set(x, y); sprite.width = size * stretch; sprite.height = size; sprite.alpha = opacity;
    this.active.push(particle);
  }

  private release(index: number) {
    const particle = this.active[index];
    particle.sprite.visible = false;
    this.free.push(particle);
    this.active[index] = this.active[this.active.length - 1];
    this.active.pop();
  }

  burst(x: number, y: number, color: number, count: number, speed: number, size = 6, angle?: number) {
    const factor = this.settings.quality === 'low' ? 0.45 : this.settings.quality === 'high' ? 1.2 : 1;
    const motion = this.settings.reducedMotion ? 0.55 : 1;
    for (let i = 0; i < Math.ceil(count * factor); i++) {
      const direction = angle === undefined ? this.random() * Math.PI * 2 : angle + (this.random() - 0.5) * 1.9;
      const velocity = (0.25 + this.random() * 0.75) * speed * motion;
      this.add(x, y, this.textures.spark, color, 0.18 + this.random() * 0.32, size * (0.6 + this.random()), 0,
        Math.cos(direction) * velocity, Math.sin(direction) * velocity, 0.95, 2.7, direction);
    }
  }

  ring(x: number, y: number, color: number, start: number, end: number, life = 0.45) {
    this.add(x, y, this.textures.ring, color, life, start, this.settings.reducedMotion ? start + Math.min(90, end - start) : end, 0, 0, this.settings.reducedMotion ? 0.5 : 0.75);
  }

  trail(x: number, y: number, angle: number) {
    if (this.settings.reducedMotion) return;
    this.add(x, y, this.textures.player, 0x8fffee, 0.24, 77, 56, 0, 0, 0.38, 1, angle, false);
    this.add(x, y, this.textures.glow, 0x70ffdf, 0.22, 72, 25, 0, 0, 0.23);
  }

  private createLabel(bitmap: boolean): Text | BitmapText {
    const label = bitmap ? new BitmapText({ text: '', style: { fontFamily: EFFECT_NUMBER_FONT, fontSize: 19, fill: 0xffffff } })
      : new Text({ text: '', style: { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 20, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x111427, width: 4 } }, resolution: 1.5 });
    label.anchor.set(0.5); this.labels.addChild(label); return label;
  }
  private setLabelColor(label: Text | BitmapText, color: number): void {
    if (label instanceof BitmapText) label.tint = color;
    else label.style.fill = color;
  }

  private label(x: number, y: number, message: string, color: number, amount = 0, target: number | null = null, priority = amount > 0 ? 0 : 2, key: string | null = null) {
    const bitmap = amount > 0 || /\d/.test(message);
    if (bitmap) message = numberMessage(message);
    const existing = key !== null ? this.floats.find(float => float.key === key && float.life > 0.15)
      : target === null ? null : this.floats.find(float => float.target === target && float.life > 0.15);
    if (existing && amount > 0) {
      existing.pending += amount;
      existing.life = Math.min(1.1, existing.life + 0.1);
      if (priority > existing.priority) { existing.priority = priority; this.setLabelColor(existing.label, color); }
      return;
    }
    if (existing && key !== null) {
      if ((existing.label instanceof BitmapText) !== bitmap) { existing.label.destroy(); existing.label = this.createLabel(bitmap); }
      existing.label.text = message; this.setLabelColor(existing.label, color);
      existing.x = x; existing.y = y - 32; existing.life = existing.total = 0.85;
      return;
    }
    if (priority === 0 && this.floats.length >= 32) return;
    if (this.floats.length >= 36) {
      const replace = this.floats.findIndex(float => float.priority < priority);
      if (replace < 0) return;
      this.releaseLabel(replace);
    }
    const reusable = this.floatFree.findIndex(item => (item.label instanceof BitmapText) === bitmap);
    let float = reusable < 0 ? this.floatFree.pop() : this.floatFree.splice(reusable, 1)[0];
    if (!float) {
      const label = this.createLabel(bitmap);
      float = { label, life: 0, total: 0, x, y, amount: 0, pending: 0, commit: 0, target, priority, key };
    }
    if ((float.label instanceof BitmapText) !== bitmap) { float.label.destroy(); float.label = this.createLabel(bitmap); }
    float.label.visible = true;
    float.label.text = message;
    this.setLabelColor(float.label, color);
    float.label.style.fontSize = amount > 15 ? 26 : amount > 0 ? 19 : 21;
    Object.assign(float, { life: 0.85, total: 0.85, x: x + (this.random() - 0.5) * 10, y: y - 32, amount, pending: 0, commit: 0.1, target, priority, key });
    this.floats.push(float);
  }

  private releaseLabel(index: number) {
    const float = this.floats[index];
    float.label.visible = false; this.floatFree.push(float);
    this.floats[index] = this.floats[this.floats.length - 1]; this.floats.pop();
  }

  handle(event: CombatEvent) {
    const { x, y, angle = 0 } = event;
    const color = event.color ?? 0x90f9e2;
    this.emissionPriority = ['damage', 'beam', 'shieldBreak', 'interrupt', 'module', 'support', 'levelup', 'xpLoss'].includes(event.type)
      || event.hitResult === 'weakpoint' || event.hitResult === 'part' || event.text === 'deviceBurst' || event.type === 'card' && event.text === 'cleared' ? 2 : 0;
    switch (event.type) {
      case 'shot':
        this.add(x, y, this.textures.glow, color, 0.075, event.text === 'drone' ? 34 : 70, 15, 0, 0, 0.6);
        this.burst(x, y, color, event.text === 'drone' ? 1 : 3, 175, 3, angle);
        break;
      case 'enemyShot':
        this.add(x, y, this.textures.glow, 0xff8959, 0.09, 45, 0, 0, 0, 0.4);
        break;
      case 'attack':
        if (event.text === 'deviceBurst') {
          // The ring atlas has radius 59 in a 128px frame; match the instantaneous blast footprint.
          const size = (event.amount ?? 140) * 128 / 59;
          this.add(x, y, this.textures.ring, 0xffd69a, 0.3, size, size, 0, 0, 0.9);
          this.burst(x, y, 0xffc27d, 18, 200, 5);
          this.add(x, y, this.textures.glow, 0xffbc74, 0.2, 150, 60, 0, 0, this.settings.reducedMotion ? 0.12 : 0.24);
        } else if (event.text === 'impact') {
          this.ring(x, y, 0xffc8a0, 18, (event.amount ?? 100) * 2, 0.35);
          this.burst(x, y, 0xffa574, 16, 210, 5);
        }
        break;
      case 'hit': {
        const shield = event.hitResult === 'shield', weak = event.hitResult === 'weakpoint', part = event.hitResult === 'part';
        const tint = shield ? 0xcad8eb : weak ? 0xffe9a8 : part ? 0xffc097 : color;
        // Deflections rebound against the incoming shot; real hits continue along its direction.
        this.burst(x, y, tint, shield ? 3 : weak || part ? 10 : 5, shield ? 100 : 200, shield ? 3 : weak ? 5 : 4, angle + (shield ? Math.PI : 0));
        if (weak || part) this.ring(x, y, tint, 8, part ? 100 : 60, 0.22);
        const important = weak || part || (event.amount ?? 0) >= 10;
        if ((event.amount ?? 0) > 0 && this.settings.damageNumbers !== 'off' && (this.settings.damageNumbers === 'all' || important)) {
          this.label(x, y, damageText(event.amount!), tint, event.amount, event.targetId ?? null, important ? 1 : 0,
            event.targetId === undefined ? null : `damage-${event.targetId}-${event.hitResult ?? 'body'}`);
        }
        break;
      }
      case 'kill':
        if (event.hitResult === 'part') {
          this.ring(x, y, 0xffd3a0, 15, 115, 0.35);
          for (let i = 0; i < 5; i++) {
            const direction = angle + i * TAU / 5, speed = this.settings.reducedMotion ? 50 : 160;
            this.add(x, y, this.textures.spark, i % 2 ? 0xe2cad4 : 0xffd3a0, 0.38, 6, 2,
              Math.cos(direction) * speed, Math.sin(direction) * speed, 0.95, 2.2, direction, false);
          }
          this.label(x, y, event.enemyType === 'node' ? '节点停机' : '部件击破', 0xffd9ad);
          break;
        }
        this.ring(x, y, color, 16, event.enemyType === 'boss' ? 850 : 125, event.enemyType === 'boss' ? 1.2 : 0.4);
        this.burst(x, y, color, event.enemyType === 'boss' ? 80 : 12, event.enemyType === 'boss' ? 650 : 280, 5);
        this.add(x, y, this.textures.glow, color, 0.22, 135, 15, 0, 0, 0.45);
        break;
      case 'dash':
        this.ring(x, y, 0x77ffdc, 25, 120, 0.3);
        this.burst(x, y, 0x9cffe7, 14, 290, 5, angle + Math.PI);
        break;
      case 'bomb':
        this.ring(x, y, 0xffd8a0, 20, 1520, 0.7);
        this.ring(x, y, 0xfff0d4, 0, 950, 0.55);
        this.burst(x, y, 0xffd19a, 48, 850, 8);
        this.add(x, y, this.textures.glow, 0xffd0a0, 0.5, 1000, 100, 0, 0, 0.3);
        break;
      case 'damage':
        this.burst(x, y, 0xff7191, 18, 270, 6);
        this.ring(x, y, 0xff7291, 32, 130, 0.3);
        break;
      case 'pickup':
        this.burst(x, y, color, event.pickupType === 'xp' ? 3 : 10, 110, 3);
        if (event.pickupType !== 'xp' && event.pickupType !== 'support') {
          const names = { hp: `血药 +${event.amount ?? 1}`, bomb: '炸弹 +1', supply: '技能补给', coolant: '快速冷却', miniBomb: '微型爆破', blackHole: '黑洞引力', xp: '' };
          this.label(x, y, event.text ?? names[event.pickupType ?? 'xp'], color);
        }
        break;
      case 'heal':
        this.burst(x, y, color, 8, 100, 3);
        this.label(x, y - 24, `恢复 +${event.amount ?? 1} HP`, color);
        break;
      case 'levelup':
        this.ring(x, y, 0x8cfbdd, 40, 420, 0.8);
        this.ring(x, y, 0xe7d4ff, 30, 270, 0.65);
        this.burst(x, y, 0xbaffec, 28, 270, 5);
        this.label(x, y - 26, `LEVEL ${event.amount ?? ''}`, 0xbbffef);
        break;
      case 'leveldown': this.label(x, y, event.text === 'XP LOST' ? '经验损失' : '武装降级', 0xffa6bb); break;
      case 'xpLoss': if ((event.amount ?? 0) > 0) this.label(x, y, `${event.text === '共鸣经验' ? '共鸣经验' : '经验'} −${Math.round(event.amount!)}`, 0xffb4c7); break;
      case 'shieldBreak':
        this.burst(x, y, 0xd1e7ff, 16, 250, 7, angle); this.ring(x, y, 0xd1e7ff, 22, 135, 0.3);
        this.label(x, y, '护盾击破', 0xe0eeff); break;
      case 'interrupt':
        this.ring(x, y, 0xffdc9f, 12, 90, 0.25); this.burst(x, y, 0xffdc9f, 8, 170, 4, angle);
        this.label(x, y, '打断', 0xffe8b7); break;
      case 'module':
        this.burst(x, y, 0xc2d8ff, 6, 100, 4);
        this.label(x, y, event.moduleId ? MODULES[event.moduleId].name : event.text ?? '模块触发', 0xd3e6ff, 0, null, 2, `module-${event.moduleId ?? 'trigger'}`); break;
      case 'upgrade':
        this.ring(x, y, 0xc2d8ff, 20, 150, 0.45); break;
      case 'card':
        if (event.text === 'cleared') {
          this.ring(x, y, 0xffe3b9, 150, 35, 0.32);
          this.burst(x, y, 0xe3d1ff, 18, 170, 5);
          this.label(x, y, `符卡 ${event.amount ?? ''} 击破`, 0xffedc8, 0, null, 2, 'card-cleared');
        }
        break;
      case 'spawn': this.ring(x, y, color, 70, 15, 0.3); break;
      case 'beam': {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        this.burst(x + dx * 44, y + dy * 44, 0xbefff0, 22, 700, 7, angle);
        if (!this.settings.reducedMotion) {
          this.ring(x, y, 0xb6ffe7, 18, 175, 0.35);
          this.add(x, y, this.textures.glow, 0x5bffd6, 0.25, 230, 40, 0, 0, 0.24);
          for (let distance = 100; distance < 1000; distance += 110) {
            const side = (this.random() - 0.5) * 70;
            this.add(x + dx * distance - dy * side, y + dy * distance + dx * side,
              this.textures.spark, 0xb9ffed, 0.18 + this.random() * 0.15, 6, 0,
              dx * 550, dy * 550, 0.8, 5, angle);
          }
        }
        break;
      }
      case 'support':
        this.burst(x, y, 0xa4ecff, 15, 155, 4);
        if (!this.settings.reducedMotion) this.ring(x, y, 0xa1edff, 18, 120, 0.55);
        this.label(x, y - 10, event.text === 'arrival' ? '子机补给抵达' : `子机接入 ${event.amount ?? 1}/3`, 0xbdf5ff, 0, null, 2, `support-${event.text ?? 'deployed'}`);
        break;
    }
    this.emissionPriority = 0;
  }

  update(dt: number) {
    const delta = Math.min(0.05, Math.max(0, dt));
    for (let index = this.active.length - 1; index >= 0; index--) {
      const particle = this.active[index];
      particle.life -= delta;
      if (particle.life <= 0) { this.release(index); continue; }
      const progress = 1 - particle.life / particle.total;
      particle.x += particle.vx * delta; particle.y += particle.vy * delta;
      if (this.stressBounds) {
        const { x, y } = this.stressBounds;
        if (particle.x < x - 800) particle.x += 1600;
        if (particle.x > x + 800) particle.x -= 1600;
        if (particle.y < y - 450) particle.y += 900;
        if (particle.y > y + 450) particle.y -= 900;
      }
      const damping = Math.exp(-particle.damping * delta);
      particle.vx *= damping; particle.vy *= damping;
      const eased = 1 - (1 - progress) ** 2;
      const size = particle.startSize + (particle.endSize - particle.startSize) * eased;
      particle.sprite.position.set(particle.x, particle.y);
      particle.sprite.width = size * particle.stretch; particle.sprite.height = size;
      particle.sprite.alpha = particle.opacity * (1 - progress) ** 1.2;
      particle.sprite.rotation += particle.spin * delta;
    }
    for (let index = this.floats.length - 1; index >= 0; index--) {
      const float = this.floats[index];
      float.life -= delta; float.commit -= delta;
      if (float.life <= 0) {
        this.releaseLabel(index);
        continue;
      }
      if (float.pending && float.commit <= 0) {
        float.amount += float.pending; float.pending = 0;
        float.label.text = damageText(float.amount); float.commit = 0.1;
      }
      float.y -= delta * (this.settings.reducedMotion ? 9 : 30);
      float.label.position.set(float.x, float.y);
      float.label.alpha = Math.min(1, float.life / 0.2);
      const size = this.settings.reducedMotion ? 1 : Math.min(1.12, 1 + Math.max(0, float.life - 0.65));
      float.label.scale.set(size);
    }
  }

  reset() {
    this.stressBounds = null;
    this.emissionPriority = 0;
    while (this.active.length) this.release(this.active.length - 1);
    for (const float of this.floats) { float.label.visible = false; this.floatFree.push(float); }
    this.floats.length = 0;
  }

  debugStress(x: number, y: number) {
    this.reset();
    this.stressBounds = { x, y };
    for (let i = 0; i < Math.min(900, QUALITY[this.settings.quality].particles); i++) {
      const angle = this.random() * TAU;
      this.add(x + (this.random() - 0.5) * 1600, y + (this.random() - 0.5) * 900,
        this.textures.spark, i % 2 ? 0x8bf8dc : 0xc8b4ff, 3600, 4, 4, Math.cos(angle) * 60, Math.sin(angle) * 60, 0.8, 2, angle);
      this.active[this.active.length - 1].damping = 0;
    }
  }

  get count() { return this.active.length; }
  get labelTextureCount() { return this.labels.children.filter(label => label instanceof Text).length + (numberFont?.pages.length ?? Number(this.labels.children.some(label => label instanceof BitmapText))); }
  destroy() {
    this.particles.destroy({ children: true });
    this.labels.destroy({ children: true });
    this.active.length = 0; this.free.length = 0; this.floats.length = 0; this.floatFree.length = 0;
  }
}
