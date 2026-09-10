import { Container, Sprite, Text, Texture } from 'pixi.js';
import { QUALITY } from './config';
import { TAU } from './math';
import type { CombatEvent, GameSettings } from './types';

export interface EffectTextures { glow: Texture; spark: Texture; ring: Texture; player: Texture }
interface Particle {
  sprite: Sprite; x: number; y: number; vx: number; vy: number; life: number; total: number;
  startSize: number; endSize: number; stretch: number; spin: number; opacity: number; damping: number;
}
interface FloatLabel { label: Text; life: number; total: number; x: number; y: number; amount: number; pending: number; commit: number; target: number | null }

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
  }

  private add(x: number, y: number, texture: Texture, color: number, life: number, size: number, endSize: number, vx = 0, vy = 0, opacity = 1, stretch = 1, angle = 0, additive = true) {
    if (this.active.length >= QUALITY[this.settings.quality].particles) return;
    let particle = this.free.pop();
    if (!particle) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      this.particles.addChild(sprite);
      particle = { sprite, x: 0, y: 0, vx: 0, vy: 0, life: 0, total: 0, startSize: 0, endSize: 0, stretch: 1, spin: 0, opacity: 1, damping: 3 };
    }
    const sprite = particle.sprite;
    sprite.visible = true; sprite.texture = texture; sprite.tint = color; sprite.rotation = angle;
    sprite.blendMode = additive ? 'add' : 'normal';
    Object.assign(particle, { x, y, vx, vy, life, total: life, startSize: size, endSize, opacity, stretch, spin: 0, damping: 3 });
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
    this.add(x, y, this.textures.ring, color, life, start, end, 0, 0, 0.75);
  }

  trail(x: number, y: number, angle: number) {
    if (this.settings.reducedMotion) return;
    this.add(x, y, this.textures.player, 0x8fffee, 0.24, 77, 56, 0, 0, 0.38, 1, angle, false);
    this.add(x, y, this.textures.glow, 0x70ffdf, 0.22, 72, 25, 0, 0, 0.23);
  }

  private label(x: number, y: number, message: string, color: number, amount = 0, target: number | null = null) {
    const existing = target === null ? null : this.floats.find(float => float.target === target && float.life > 0.15);
    if (existing && amount > 0) {
      existing.pending += amount;
      existing.life = Math.min(1.1, existing.life + 0.1);
      return;
    }
    if (this.floats.length >= 36) return;
    let float = this.floatFree.pop();
    if (!float) {
      const label = new Text({ text: '', style: {
        fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 20, fontWeight: '700',
        fill: 0xffffff, stroke: { color: 0x111427, width: 4 },
      }, resolution: 1.5 });
      label.anchor.set(0.5);
      this.labels.addChild(label);
      float = { label, life: 0, total: 0, x, y, amount: 0, pending: 0, commit: 0, target };
    }
    float.label.visible = true;
    float.label.text = message;
    float.label.style.fill = color;
    float.label.style.fontSize = amount > 15 ? 26 : amount > 0 ? 19 : 21;
    Object.assign(float, { life: 0.85, total: 0.85, x: x + (this.random() - 0.5) * 10, y: y - 32, amount, pending: 0, commit: 0.1, target });
    this.floats.push(float);
  }

  handle(event: CombatEvent) {
    const { x, y, angle = 0 } = event;
    const color = event.color ?? 0x90f9e2;
    switch (event.type) {
      case 'shot':
        this.add(x, y, this.textures.glow, color, 0.075, event.text === 'drone' ? 34 : 70, 15, 0, 0, 0.6);
        this.burst(x, y, color, event.text === 'drone' ? 1 : 3, 175, 3, angle);
        break;
      case 'enemyShot':
        this.add(x, y, this.textures.glow, 0xff8959, 0.09, 45, 0, 0, 0, 0.4);
        break;
      case 'hit':
        this.burst(x, y, color, 5, 200, 4, angle);
        if ((event.amount ?? 0) > 0) this.label(x, y, `${Math.round(event.amount!)}`, color, event.amount, event.targetId ?? null);
        break;
      case 'kill':
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
          const names = { hp: '生命恢复', bomb: '炸弹 +1', ammo: '弹药补充', coolant: '快速冷却', miniBomb: '微型爆破', blackHole: '黑洞引力', xp: '' };
          this.label(x, y, event.text ?? names[event.pickupType ?? 'xp'], color);
        }
        break;
      case 'levelup':
        this.ring(x, y, 0x8cfbdd, 40, 420, 0.8);
        this.ring(x, y, 0xe7d4ff, 30, 270, 0.65);
        this.burst(x, y, 0xbaffec, 28, 270, 5);
        this.label(x, y - 26, `LEVEL ${event.amount ?? ''}`, 0xbbffef);
        break;
      case 'leveldown': this.label(x, y, '武装降级', 0xffa6bb); break;
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
        this.label(x, y - 10, event.text === 'arrival' ? '子机补给抵达' : `子机接入 ${event.amount ?? 1}/3`, 0xbdf5ff);
        break;
    }
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
        float.label.visible = false;
        this.floatFree.push(float);
        this.floats[index] = this.floats[this.floats.length - 1]; this.floats.pop();
        continue;
      }
      if (float.pending && float.commit <= 0) {
        float.amount += float.pending; float.pending = 0;
        float.label.text = `${Math.round(float.amount)}`; float.commit = 0.1;
      }
      float.y -= delta * (this.settings.reducedMotion ? 9 : 30);
      float.label.position.set(float.x, float.y);
      float.label.alpha = Math.min(1, float.life / 0.2);
      const size = Math.min(1.12, 1 + Math.max(0, float.life - 0.65));
      float.label.scale.set(size);
    }
  }

  reset() {
    this.stressBounds = null;
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
  get labelTextureCount() { return this.floats.length + this.floatFree.length; }
  destroy() {
    this.particles.destroy({ children: true });
    this.labels.destroy({ children: true });
    this.active.length = 0; this.free.length = 0; this.floats.length = 0; this.floatFree.length = 0;
  }
}
