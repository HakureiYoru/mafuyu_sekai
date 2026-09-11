import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { ASSET_URLS, BALANCE, ENEMIES, QUALITY, VIEW, WORLD } from './config';
import { EffectSystem } from './effects';
import { bossAttacks } from './boss-ai';
import { miniBossAttacks } from './miniboss-ai';
import { enemyAttacks } from './enemy-ai';
import { beamGeometry, clamp, lerp, TAU } from './math';
import type { CombatEvent, Enemy, EnemyType, GameSettings, Pickup, PickupType, WorldState } from './types';

type AssetKey = keyof typeof ASSET_URLS;
const SUPPORT_ASSET_URLS = {
  drone: 'drone.png', ammo: 'ammo.png', coolant: 'coolant.png', support: 'support-module.png',
  bomb: 'bomb.svg', miniBomb: 'mini-bomb.svg', blackHole: 'black-hole.svg', mine: 'mine.svg',
} as const;
type SupportAssetKey = keyof typeof SUPPORT_ASSET_URLS;
interface EnemyVisual { root: Container; halo: Sprite; badge: Sprite; hazard: Sprite; art: Sprite; hit: Sprite; health: Sprite; bar: Sprite; seen: number }
interface PickupVisual { root: Container; glow: Sprite; backing: Sprite; icon: Sprite; seen: number }
interface BulletVisual { effect: Sprite; core: Sprite }
interface CompanionVisual { root: Container; glow: Sprite; ship: Sprite; barrel: Sprite }
interface Atlas { glow: Texture; spark: Texture; ring: Texture; bolt: Texture; hostile: Texture; hostileCore: Texture; player: Texture; mine: Texture; diamond: Texture; cross: Texture; pickupPlate: Texture; caution: Texture; badges: Record<EnemyType, Texture> }
const WHITE = 0xf5f2ff;
const COLORS: Record<PickupType, number> = { xp: 0xa2fce2, hp: 0xff94b6, bomb: 0xffda94, ammo: 0x89e3ff, coolant: 0x8ff7e6, miniBomb: 0xffbd82, blackHole: 0xc5a0ff, support: 0x8bebff };
const PICKUP_NAMES: Record<Exclude<PickupType, 'xp'>, string> = { hp: '生命恢复', ammo: '弹药补充', coolant: '冷却胶囊', bomb: '炸弹 +1', miniBomb: '范围爆破', blackHole: '引力黑洞', support: '支援子机' };

function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图形资源，请更新浏览器后重试。');
  paint(context);
  return Texture.from(canvas);
}

function makeAtlas(): { atlas: Atlas; texture: Texture } {
  const texture = canvasTexture(2048, 768, context => {
    context.scale(2, 2);
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(255,255,255,.85)'); gradient.addColorStop(0.2, 'rgba(255,255,255,.55)');
    gradient.addColorStop(0.48, 'rgba(255,255,255,.16)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
    context.fillStyle = '#fff';
    context.beginPath(); context.roundRect(137, 24, 110, 16, 8); context.fill();
    context.strokeStyle = '#fff'; context.lineWidth = 2;
    context.beginPath(); context.arc(320, 64, 59, 0, TAU); context.stroke();
    context.fillStyle = '#fff';
    context.globalAlpha = 0.16; context.beginPath(); context.roundRect(388, 12, 120, 40, 20); context.fill();
    context.globalAlpha = 0.5; context.beginPath(); context.roundRect(390, 21, 116, 22, 11); context.fill();
    context.globalAlpha = 1; context.beginPath(); context.roundRect(396, 27, 104, 10, 5); context.fill();
    context.globalAlpha = 0.2; context.beginPath(); context.arc(544, 32, 29, 0, TAU); context.fill();
    context.globalAlpha = 1; context.beginPath(); context.arc(544, 32, 13, 0, TAU); context.fill();
    context.fillStyle = '#262034'; context.beginPath(); context.arc(544, 32, 8, 0, TAU); context.fill();
    context.fillStyle = '#fff'; context.beginPath(); context.arc(544, 32, 4, 0, TAU); context.fill();
    context.lineWidth = 2;
    context.beginPath(); context.arc(640, 64, 47, 0, TAU); context.stroke();
    context.globalAlpha = 0.3; context.beginPath(); context.arc(640, 64, 56, 0, TAU); context.stroke(); context.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      context.beginPath(); context.moveTo(640 + Math.cos(angle) * 42, 64 + Math.sin(angle) * 42);
      context.lineTo(640 + Math.cos(angle) * 52, 64 + Math.sin(angle) * 52); context.stroke();
    }
    context.save(); context.translate(768, 64); context.rotate(Math.PI / 4);
    context.fillStyle = '#14242a'; context.fillRect(-28, -28, 56, 56);
    context.lineWidth = 3; context.strokeRect(-28, -28, 56, 56); context.strokeRect(-38, -38, 76, 76);
    context.restore();
    context.fillStyle = '#fff'; context.fillRect(764, 43, 8, 25); context.beginPath(); context.arc(768, 78, 4, 0, TAU); context.fill();
    context.beginPath(); context.moveTo(864, 13); context.lineTo(883, 32); context.lineTo(864, 51); context.lineTo(845, 32); context.closePath(); context.fill();
    context.lineWidth = 3; context.beginPath(); context.moveTo(928, 17); context.lineTo(928, 47); context.moveTo(913, 32); context.lineTo(943, 32); context.stroke();
    const types: EnemyType[] = ['basic', 'dasher', 'sniper', 'sprayer', 'minelayer', 'mine', 'boss', 'miniboss'];
    types.forEach((type, index) => {
      context.save(); context.translate(index * 128 + 64, 192);
      context.strokeStyle = '#fff'; context.lineWidth = type === 'boss' ? 1 : 2;
      const sides = type === 'dasher' ? 3 : type === 'sniper' ? 4 : type === 'minelayer' ? 4 : type === 'sprayer' ? 6 : type === 'boss' ? 8 : type === 'miniboss' ? 5 : 0;
      if (sides) {
        context.beginPath();
        for (let i = 0; i <= sides; i++) {
          const angle = i * TAU / sides - Math.PI / 2;
          const x = Math.cos(angle) * 53, y = Math.sin(angle) * 53;
          if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      } else { context.beginPath(); context.arc(0, 0, 49, 0, TAU); context.stroke(); }
      context.globalAlpha = 0.24; context.beginPath(); context.arc(0, 0, 44, 0, TAU); context.stroke();
      context.globalAlpha = 1;
      for (let i = 0; i < (type === 'boss' ? 16 : 4); i++) {
        const angle = i * TAU / (type === 'boss' ? 16 : 4);
        context.beginPath(); context.moveTo(Math.cos(angle) * 54, Math.sin(angle) * 54);
        context.lineTo(Math.cos(angle) * 60, Math.sin(angle) * 60); context.stroke();
      }
      context.restore();
    });
    // Hostile projectiles have a solid warm arrow silhouette, unlike friendly crystal shots.
    context.save(); context.translate(0, 256);
    context.beginPath(); context.moveTo(18, 18); context.lineTo(76, 18); context.lineTo(111, 32);
    context.lineTo(76, 46); context.lineTo(18, 46); context.quadraticCurveTo(6, 32, 18, 18); context.closePath();
    context.strokeStyle = '#0b1120'; context.lineWidth = 12; context.lineJoin = 'round'; context.stroke();
    const hostileGradient = context.createLinearGradient(0, 18, 0, 46);
    hostileGradient.addColorStop(0, '#ffbd64'); hostileGradient.addColorStop(0.5, '#ff5c3b'); hostileGradient.addColorStop(1, '#d93436');
    context.fillStyle = hostileGradient; context.fill(); context.strokeStyle = '#fff1c7'; context.lineWidth = 3; context.stroke();
    context.beginPath(); context.moveTo(26, 25); context.lineTo(73, 25); context.lineTo(91, 32);
    context.strokeStyle = '#fff5da'; context.lineWidth = 4; context.stroke(); context.restore();
    context.save(); context.translate(128, 256);
    context.fillStyle = '#071b22'; context.beginPath(); context.roundRect(7, 10, 83, 83, 14); context.fill();
    context.fillStyle = '#c5f4e9'; context.beginPath(); context.roundRect(8, 6, 80, 80, 12); context.fill();
    context.strokeStyle = '#f7fff9'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#6ebfaf'; context.fillRect(16, 16, 12, 3); context.fillRect(69, 72, 10, 3);
    context.restore();
    context.save(); context.translate(320, 304);
    context.beginPath(); context.arc(0, 0, 35, 0, TAU); context.strokeStyle = '#11161d'; context.lineWidth = 8; context.stroke();
    context.setLineDash([8, 5]); context.strokeStyle = '#ffd267'; context.lineWidth = 3; context.stroke();
    context.setLineDash([]); context.restore();
  });
  const frame = (x: number, y: number, width: number, height: number) => new Texture({ source: texture.source, frame: new Rectangle(x * 2, y * 2, width * 2, height * 2) });
  const types: EnemyType[] = ['basic', 'dasher', 'sniper', 'sprayer', 'minelayer', 'mine', 'boss', 'miniboss'];
  return { texture, atlas: {
    glow: frame(0, 0, 128, 128), spark: frame(128, 0, 128, 64), ring: frame(256, 0, 128, 128),
    bolt: frame(384, 0, 128, 64), hostile: frame(512, 0, 64, 64), player: frame(576, 0, 128, 128),
    mine: frame(704, 0, 128, 128), diamond: frame(832, 0, 64, 64), cross: frame(896, 0, 64, 64),
    badges: Object.fromEntries(types.map((type, index) => [type, frame(index * 128, 128, 128, 128)])) as Record<EnemyType, Texture>,
    hostileCore: frame(0, 256, 128, 64), pickupPlate: frame(128, 256, 96, 96), caution: frame(272, 256, 96, 96),
  } };
}

function centered(texture: Texture, size: number, color = 0xffffff): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5); sprite.width = size; sprite.height = size; sprite.tint = color;
  return sprite;
}

/** WebGL scene only. GameRuntime owns the sole requestAnimationFrame and all gameplay state. */
export class GameRenderer {
  private readonly app = new Application();
  private readonly scene = new Container();
  private readonly world = new Container();
  private readonly backdrop = new Container();
  private readonly warnings = new Graphics();
  private readonly playerBeams = new Graphics();
  private readonly mineHazards = new Container();
  private readonly pickupLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly bulletLayer = new Container();
  private readonly bulletCoreLayer = new Container();
  private readonly playerLayer = new Container();
  private readonly companionLayer = new Container();
  private readonly pickupHintLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly playerMarks = new Graphics();
  private readonly ambient = new Graphics();
  private readonly edgeFeedback = new Container();
  private readonly enemies = new Map<number, EnemyVisual>();
  private readonly enemyFree: EnemyVisual[] = [];
  private readonly pickups = new Map<number, PickupVisual>();
  private readonly pickupFree: PickupVisual[] = [];
  private readonly bullets: BulletVisual[] = [];
  private readonly companions: CompanionVisual[] = [];
  private assets!: Record<AssetKey, Texture>;
  private supportAssets!: Record<SupportAssetKey, Texture>;
  private pickupHint!: Text;
  private atlas!: Atlas;
  private generated: Texture[] = [];
  private effects!: EffectSystem;
  private playerArt!: Sprite;
  private playerHit!: Sprite;
  private playerRing!: Sprite;
  private playerGlow!: Sprite;
  private damageEdge!: Sprite;
  private warningEdge!: Sprite;
  private flashEdge!: Sprite;
  private initialized = false;
  private appReady = false;
  private disposed = false;
  private generation = 0;
  private clock = 0;
  private trailClock = 0;
  private shake = 0;
  private damage = 0;
  private flash = 0;
  private warning = 0;
  private cameraX = WORLD.width / 2;
  private cameraY = WORLD.height / 2;
  private pointer = { x: VIEW.width / 2, y: VIEW.height / 2, inside: false };
  private stars = Array.from({ length: 100 }, (_, index) => ({ x: ((index * 761 + 43) % 1600), y: ((index * 331 + 89) % 900), phase: index * 1.47 }));

  constructor(private readonly host: HTMLElement, private settings: GameSettings) {}

  async init(onProgress?: (ratio: number) => void): Promise<void> {
    const images = {} as Record<AssetKey, HTMLImageElement>;
    const supportImages = {} as Record<SupportAssetKey, HTMLImageElement>;
    let completed = 0;
    await Promise.all([...(Object.keys(ASSET_URLS) as AssetKey[]).map(async key => {
      const image = new Image(); image.decoding = 'async'; image.src = ASSET_URLS[key];
      await image.decode().catch(() => { throw new Error(`素材加载失败：${key}.png，请刷新后重试。`); });
      images[key] = image;
      onProgress?.(++completed / 14);
    }), ...(Object.keys(SUPPORT_ASSET_URLS) as SupportAssetKey[]).map(async key => {
      const image = new Image(); image.decoding = 'async';
      image.src = `${import.meta.env.BASE_URL}assets/support/${SUPPORT_ASSET_URLS[key]}`;
      await image.decode().catch(() => { throw new Error(`素材加载失败：${SUPPORT_ASSET_URLS[key]}，请刷新后重试。`); });
      supportImages[key] = image; onProgress?.(++completed / 14);
    })]);
    if (this.disposed) return;
    await this.app.init({ width: VIEW.width, height: VIEW.height, backgroundColor: 0x090c19,
      preference: 'webgl', preferWebGLVersion: 2, autoStart: false, sharedTicker: false,
      antialias: false, autoDensity: false, resolution: 1, powerPreference: 'high-performance',
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    this.appReady = true;
    if (this.disposed) { this.app.destroy(true, { children: true }); this.appReady = false; return; }
    this.assets = Object.fromEntries((Object.keys(images) as AssetKey[]).map(key => [key, Texture.from(images[key])])) as Record<AssetKey, Texture>;
    this.supportAssets = Object.fromEntries((Object.keys(supportImages) as SupportAssetKey[]).map(key => [key, Texture.from(supportImages[key])])) as Record<SupportAssetKey, Texture>;
    const { atlas, texture } = makeAtlas(); this.atlas = atlas; this.generated.push(texture);
    const silhouette = (image: HTMLImageElement) => canvasTexture(image.width, image.height, context => {
      context.drawImage(image, 0, 0); context.globalCompositeOperation = 'source-in'; context.fillStyle = '#fff'; context.fillRect(0, 0, image.width, image.height);
    });
    const playerWhite = silhouette(images.player), enemyWhite = silhouette(images.enemy);
    this.generated.push(playerWhite, enemyWhite);
    // Retain one shared silhouette texture instead of allocating a filter for each hit.
    this.enemyWhite = enemyWhite;
    this.effects = new EffectSystem({ glow: atlas.glow, spark: atlas.spark, ring: atlas.ring, player: this.assets.player }, this.settings);
    this.app.stage.eventMode = 'none';
    this.app.stage.addChild(this.scene);
    this.scene.addChild(this.world, this.ambient, this.edgeFeedback, this.overlay);
    // Warnings stay above enemy art. Hostile projectiles and the player stay above every beam.
    this.world.addChild(this.backdrop, this.pickupLayer, this.effects.particles, this.enemyLayer,
      this.playerBeams, this.mineHazards, this.warnings, this.companionLayer, this.bulletLayer,
      this.bulletCoreLayer, this.playerLayer, this.playerMarks, this.effects.labels, this.pickupHintLayer);
    this.pickupHint = new Text({ text: '', style: { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 17,
      fontWeight: '700', fill: 0xdffff3, stroke: { color: 0x0b1820, width: 5 } }, resolution: 1.5 });
    this.pickupHint.anchor.set(0.5); this.pickupHint.visible = false;
    this.pickupHintLayer.addChild(this.pickupHint);
    this.buildBackground();
    this.playerGlow = centered(atlas.glow, 148, 0x82ffe0); this.playerGlow.alpha = 0.18; this.playerGlow.blendMode = 'add';
    this.playerRing = centered(atlas.player, 84, 0x91ffe4); this.playerRing.alpha = 0.9;
    this.playerArt = centered(this.assets.player, 83);
    this.playerHit = centered(playerWhite, 83); this.playerHit.alpha = 0;
    this.playerLayer.addChild(this.playerGlow, this.playerRing, this.playerArt, this.playerHit);
    const edgeTexture = canvasTexture(512, 288, context => {
      context.translate(256, 144); context.scale(256, 144);
      const gradient = context.createRadialGradient(0, 0, 0.58, 0, 0, 1.24);
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(0.5, 'rgba(255,255,255,.08)');
      gradient.addColorStop(0.77, 'rgba(255,255,255,.42)'); gradient.addColorStop(1, 'rgba(255,255,255,1)');
      context.fillStyle = gradient; context.fillRect(-1, -1, 2, 2);
    });
    this.generated.push(edgeTexture);
    this.damageEdge = new Sprite(edgeTexture); this.warningEdge = new Sprite(edgeTexture); this.flashEdge = new Sprite(edgeTexture);
    this.damageEdge.tint = 0xff416f; this.warningEdge.tint = 0xc090fa; this.flashEdge.tint = 0xffd4a2;
    for (const sprite of [this.damageEdge, this.warningEdge, this.flashEdge]) {
      sprite.width = VIEW.width; sprite.height = VIEW.height; sprite.blendMode = 'add'; sprite.alpha = 0;
      this.edgeFeedback.addChild(sprite);
    }
    const canvas = this.app.canvas;
    canvas.setAttribute('aria-label', 'Mafuyu Sekai 战斗画面');
    canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.style.cursor = 'none';
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.host.appendChild(canvas);
    this.initialized = true;
    this.resize();
    onProgress?.(1);
  }

  private enemyWhite!: Texture;

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.app.canvas.getBoundingClientRect();
    this.pointer.x = (event.clientX - rect.left) / rect.width * VIEW.width;
    this.pointer.y = (event.clientY - rect.top) / rect.height * VIEW.height;
    this.pointer.inside = true;
  };
  private onPointerLeave = () => { this.pointer.inside = false; };

  private buildBackground() {
    const base = new Sprite(Texture.WHITE); base.tint = 0x0e1323; base.width = WORLD.width; base.height = WORLD.height;
    const image = new Sprite(this.assets.bg);
    const scale = Math.max(WORLD.width / this.assets.bg.width, WORLD.height / this.assets.bg.height);
    image.scale.set(scale); image.position.set((WORLD.width - image.width) / 2, (WORLD.height - image.height) / 2);
    image.alpha = 0.43;
    const shade = new Sprite(Texture.WHITE); shade.tint = 0x101229; shade.alpha = 0.36; shade.width = WORLD.width; shade.height = WORLD.height;
    const gridTexture = canvasTexture(160, 160, context => {
      context.strokeStyle = 'rgba(161,183,213,.1)'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(0.5, 0); context.lineTo(0.5, 160); context.moveTo(0, 0.5); context.lineTo(160, 0.5); context.stroke();
      context.fillStyle = 'rgba(175,212,234,.35)'; context.fillRect(78, 79.5, 5, 1); context.fillRect(80, 77.5, 1, 5);
    });
    this.generated.push(gridTexture);
    const grid = new TilingSprite({ texture: gridTexture, width: WORLD.width, height: WORLD.height });
    const border = new Graphics();
    border.rect(1, 1, WORLD.width - 2, WORLD.height - 2).stroke({ color: 0x9adad4, width: 3, alpha: 0.65 });
    border.rect(13, 13, WORLD.width - 26, WORLD.height - 26).stroke({ color: 0x6a9dba, width: 1, alpha: 0.2 });
    for (let i = 100; i < WORLD.width; i += 200) {
      border.moveTo(i, 0).lineTo(i, 20).moveTo(i, WORLD.height).lineTo(i, WORLD.height - 20).stroke({ color: 0x99d9d6, width: 2, alpha: 0.4 });
      border.moveTo(0, i).lineTo(20, i).moveTo(WORLD.width, i).lineTo(WORLD.width - 20, i).stroke({ color: 0x99d9d6, width: 2, alpha: 0.4 });
    }
    const center = new Graphics();
    center.circle(WORLD.width / 2, WORLD.height / 2, 210).stroke({ color: 0x80d6cf, width: 1, alpha: 0.12 });
    center.circle(WORLD.width / 2, WORLD.height / 2, 220).stroke({ color: 0xbcb1e9, width: 1, alpha: 0.08 });
    for (let i = 0; i < 8; i++) {
      const angle = i * TAU / 8;
      center.moveTo(WORLD.width / 2 + Math.cos(angle) * 205, WORLD.height / 2 + Math.sin(angle) * 205)
        .lineTo(WORLD.width / 2 + Math.cos(angle) * 230, WORLD.height / 2 + Math.sin(angle) * 230)
        .stroke({ color: 0x9ddcd9, width: 2, alpha: 0.22 });
    }
    this.backdrop.addChild(base, image, shade, grid, center, border);
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
    if (!this.initialized) return;
    this.effects.setSettings(settings);
    this.resize();
  }

  resize() {
    if (!this.initialized) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const factor = QUALITY[this.settings.quality].scale;
    const scale = Math.min(width / VIEW.width, height / VIEW.height) * Math.min(window.devicePixelRatio || 1, 2);
    const resolution = Math.max(0.25, Math.min(scale, Math.sqrt(1920 * 1080 / (VIEW.width * VIEW.height)) * factor));
    this.app.renderer.resize(VIEW.width, VIEW.height, resolution);
    this.app.canvas.style.width = '100%'; this.app.canvas.style.height = '100%';
  }

  render(state: WorldState, alpha: number, dt: number) {
    if (!this.initialized || this.disposed) return;
    const delta = clamp(dt, 0, 0.05);
    this.clock += delta;
    this.generation++;
    this.cameraX = lerp(state.camera.prevX, state.camera.x, alpha);
    this.cameraY = lerp(state.camera.prevY, state.camera.y, alpha);
    this.shake *= Math.exp(-delta * 17);
    this.damage = Math.max(0, this.damage - delta * 1.5);
    this.flash = Math.max(0, this.flash - delta * 2.3);
    this.warning = Math.max(0, this.warning - delta * 0.6);
    const shake = this.settings.reducedMotion ? 0 : this.shake * this.settings.screenShake;
    this.world.position.set(VIEW.width / 2 - this.cameraX + Math.sin(this.clock * 83) * shake,
      VIEW.height / 2 - this.cameraY + Math.cos(this.clock * 107) * shake * 0.7);
    this.renderWarnings(state, alpha);
    this.renderPickups(state);
    this.renderEnemies(state, alpha);
    this.renderPlayerBeams(state);
    this.renderCompanions(state, alpha);
    this.renderBullets(state, alpha);
    this.renderPlayer(state, alpha, delta);
    this.effects.update(delta);
    this.renderOverlay(state);
    this.app.render();
  }

  private visible(x: number, y: number, margin = 130) {
    return Math.abs(x - this.cameraX) < VIEW.width / 2 + margin && Math.abs(y - this.cameraY) < VIEW.height / 2 + margin;
  }

  private createEnemy(): EnemyVisual {
    const root = new Container();
    // Keep entity sprites in the same blend group so hundreds of halos do not split batches.
    const halo = centered(this.atlas.glow, 100);
    const badge = centered(this.atlas.badges.basic, 100);
    const hazard = centered(this.atlas.caution, 96); hazard.visible = false;
    const art = centered(this.assets.enemy, 100);
    const hit = centered(this.enemyWhite, 100);
    const health = new Sprite(Texture.WHITE); health.tint = 0x101421; health.height = 4;
    const bar = new Sprite(Texture.WHITE); bar.height = 2;
    root.addChild(halo, badge, art, hit, health, bar);
    this.enemyLayer.addChild(root);
    this.mineHazards.addChild(hazard);
    return { root, halo, badge, hazard, art, hit, health, bar, seen: 0 };
  }

  private renderEnemies(state: WorldState, alpha: number) {
    for (const enemy of state.enemies) {
      const x = lerp(enemy.prevX, enemy.x, alpha), y = lerp(enemy.prevY, enemy.y, alpha);
      if (!this.visible(x, y, enemy.radius * 2)) continue;
      let visual = this.enemies.get(enemy.id);
      if (!visual) { visual = this.enemyFree.pop() ?? this.createEnemy(); this.enemies.set(enemy.id, visual); }
      visual.seen = this.generation;
      visual.root.visible = true;
      visual.root.position.set(x, y);
      const color = ENEMIES[enemy.type].color;
      const isMine = enemy.type === 'mine';
      const hit = clamp(enemy.hitTime / 0.12, 0, 1);
      const artSize = enemy.radius * (isMine ? 1.8 : enemy.type === 'boss' ? 2.3 : 2.35);
      const motion = this.settings.reducedMotion ? 0 : clamp(enemy.vx / 150, -1, 1) * 0.07 + Math.sin(state.elapsed * 2 + enemy.id) * 0.022;
      visual.art.texture = isMine ? this.supportAssets.mine : this.assets.enemy;
      visual.art.tint = 0xffffff;
      visual.art.alpha = isMine && enemy.state === 'arming' ? 0.55 : 1;
      visual.art.width = artSize * (1 + hit * 0.08); visual.art.height = artSize * (1 - hit * 0.05);
      visual.art.rotation = enemy.type === 'mine' ? 0 : motion;
      visual.hit.visible = enemy.type !== 'mine';
      visual.hit.width = visual.art.width; visual.hit.height = visual.art.height; visual.hit.rotation = motion; visual.hit.alpha = hit * 0.72;
      visual.badge.texture = this.atlas.badges[enemy.type]; visual.badge.tint = color;
      visual.badge.visible = !isMine;
      visual.hazard.visible = isMine;
      if (isMine) {
        visual.hazard.position.set(x, y);
        visual.hazard.alpha = enemy.state === 'arming' ? 0.3 : 1;
        // The atlas dashed circle has radius 35 in a 96-unit frame: this is the real contact radius.
        visual.hazard.width = enemy.radius * 96 / 35; visual.hazard.height = visual.hazard.width;
      }
      visual.badge.width = enemy.radius * 2.95; visual.badge.height = enemy.radius * 2.95;
      visual.badge.alpha = enemy.state === 'charge' || enemy.state === 'aim' ? 0.9 : 0.55;
      visual.badge.rotation = enemy.type === 'dasher' || enemy.type === 'miniboss' ? enemy.angle + Math.PI / 2 : enemy.type === 'boss' || enemy.type === 'sprayer' ? (this.settings.reducedMotion ? 0 : state.elapsed * 0.12) : 0;
      visual.halo.visible = isMine || this.settings.quality !== 'low';
      visual.halo.width = enemy.radius * (isMine ? 2.8 : 4.3); visual.halo.height = visual.halo.width;
      visual.halo.tint = isMine ? 0x030811 : color;
      visual.halo.alpha = isMine ? 0.85 : enemy.type === 'boss' ? 0.22 : 0.11 + hit * 0.17;
      const showHealth = enemy.hp < enemy.maxHp && enemy.type !== 'mine' && enemy.type !== 'boss' && enemy.type !== 'miniboss';
      visual.health.visible = showHealth; visual.bar.visible = showHealth;
      if (showHealth) {
        const width = Math.max(36, enemy.radius * 1.5);
        visual.health.position.set(-width / 2 - 1, -enemy.radius * 1.15 - 13); visual.health.width = width + 2;
        visual.bar.position.set(-width / 2, visual.health.y + 1); visual.bar.width = width * clamp(enemy.hp / enemy.maxHp, 0, 1); visual.bar.tint = color;
      }
    }
    for (const [id, visual] of this.enemies) if (visual.seen !== this.generation) {
      visual.root.visible = false; visual.hazard.visible = false; this.enemyFree.push(visual); this.enemies.delete(id);
    }
  }

  private renderPickups(state: WorldState) {
    let nearest: Pickup | null = null, nearestDistance = 180 ** 2;
    for (const pickup of state.pickups) {
      if (!this.visible(pickup.x, pickup.y, 50)) continue;
      let visual = this.pickups.get(pickup.id);
      if (!visual) {
        visual = this.pickupFree.pop();
        if (!visual) {
          const root = new Container(), glow = centered(this.atlas.glow, 70), backing = centered(this.atlas.pickupPlate, 57), icon = centered(this.atlas.diamond, 25);
          root.addChild(glow, backing, icon); this.pickupLayer.addChild(root);
          visual = { root, glow, backing, icon, seen: 0 };
        }
        this.pickups.set(pickup.id, visual);
      }
      visual.seen = this.generation; visual.root.visible = true;
      const isXp = pickup.type === 'xp', isCan = pickup.type === 'hp';
      const size = isXp ? Math.min(23, 13 + Math.log2(Math.max(1, pickup.value / 10)) * 2) : pickup.type === 'support' ? 35 : 32;
      const bob = this.settings.reducedMotion ? 0 : Math.sin(state.elapsed * 3 + pickup.id) * (isXp ? 1.5 : 3);
      visual.root.position.set(pickup.x, pickup.y + bob);
      visual.backing.visible = !isXp;
      visual.backing.width = pickup.type === 'support' ? 64 : 57; visual.backing.height = visual.backing.width;
      visual.icon.texture = isXp ? this.assets.bullet : isCan ? this.assets.health : this.supportAssets[pickup.type as Exclude<PickupType, 'xp' | 'hp'>];
      visual.icon.width = size; visual.icon.height = size; visual.icon.rotation = 0;
      visual.icon.tint = 0xffffff;
      visual.glow.tint = isXp ? COLORS.xp : 0xa0ffe0; visual.glow.alpha = isXp ? 0.13 : 0.24;
      visual.glow.width = isXp ? 40 : 90; visual.glow.height = visual.glow.width;
      visual.glow.visible = !isXp || this.settings.quality !== 'low';
      if (!isXp) {
        const eligible = pickup.type === 'hp' ? state.player.hp < state.player.maxHp
          : pickup.type === 'ammo' ? state.player.ammo < BALANCE.ammo.max
            : pickup.type === 'coolant' ? state.player.heat > 0 : true;
        const distance = (pickup.x - state.player.x) ** 2 + (pickup.y - state.player.y) ** 2;
        if (eligible && distance < nearestDistance) { nearest = pickup; nearestDistance = distance; }
      }
    }
    for (const [id, visual] of this.pickups) if (visual.seen !== this.generation) {
      visual.root.visible = false; this.pickupFree.push(visual); this.pickups.delete(id);
    }
    this.pickupHint.visible = nearest !== null;
    if (nearest && nearest.type !== 'xp') {
      this.pickupHint.text = nearest.type === 'support' && state.companions.length >= BALANCE.companion.max
        ? '子机已满 · 转为经验' : PICKUP_NAMES[nearest.type];
      this.pickupHint.position.set(nearest.x, nearest.y + 43);
    }
  }

  private renderBullets(state: WorldState, alpha: number) {
    let used = 0;
    for (const bullet of state.bullets) {
      const x = lerp(bullet.prevX, bullet.x, alpha), y = lerp(bullet.prevY, bullet.y, alpha);
      if (!this.visible(x, y, 100)) continue;
      let visual = this.bullets[used];
      if (!visual) {
        const effect = centered(this.atlas.bolt, 10), core = centered(this.assets.bullet, 16);
        this.bulletLayer.addChild(effect); this.bulletCoreLayer.addChild(core);
        visual = { effect, core }; this.bullets.push(visual);
      }
      used++;
      const { effect, core } = visual;
      effect.visible = true; core.visible = true;
      const hostile = bullet.owner === 'enemy', perfect = bullet.kind === 'perfect';
      const angle = Math.atan2(bullet.vy, bullet.vx);
      effect.texture = hostile ? this.atlas.glow : this.atlas.bolt;
      effect.rotation = angle;
      effect.width = hostile ? Math.max(30, bullet.radius * 5) : perfect ? 115 : bullet.kind === 'special' ? 40 : bullet.kind === 'drone' ? 25 : 31;
      effect.height = hostile ? effect.width : perfect ? 29 : bullet.kind === 'special' ? 20 : 12;
      effect.tint = hostile ? 0xff713e : perfect ? 0xecffcc : bullet.color || 0x9ef8e4;
      effect.alpha = hostile ? 0.22 : 0.85;
      const tailOffset = hostile ? 0 : perfect ? 28 : 8;
      effect.position.set(x - Math.cos(angle) * tailOffset, y - Math.sin(angle) * tailOffset);
      // Friendly shots retain the original crystal; enemies use opaque warm pointed shells.
      core.texture = hostile ? this.atlas.hostileCore : this.assets.bullet;
      core.position.set(x, y); core.rotation = angle + (hostile ? 0 : Math.PI / 2);
      core.width = hostile ? Math.max(28, bullet.radius * 4.4) : perfect ? 28 : bullet.kind === 'special' ? 21 : bullet.kind === 'drone' ? 12 : 17;
      core.height = hostile ? Math.max(18, bullet.radius * 3) : core.width;
    }
    for (let index = used; index < this.bullets.length; index++) {
      this.bullets[index].effect.visible = false; this.bullets[index].core.visible = false;
    }
  }

  private renderCompanions(state: WorldState, alpha: number) {
    const count = Math.min(BALANCE.companion.max, state.companions.length);
    for (let index = 0; index < count; index++) {
      const companion = state.companions[index];
      let visual = this.companions[index];
      if (!visual) {
        const root = new Container(), glow = centered(this.atlas.glow, 78, 0x72dfff);
        const ship = centered(this.assets.player, 43), barrel = centered(this.atlas.bolt, 12, 0xc5fff8);
        ship.rotation = Math.PI / 2;
        glow.alpha = 0.26; barrel.width = 20; barrel.height = 7; barrel.position.x = 20;
        root.addChild(glow, barrel, ship); this.companionLayer.addChild(root);
        visual = { root, glow, ship, barrel }; this.companions.push(visual);
      }
      visual.root.visible = true;
      visual.root.position.set(lerp(companion.prevX, companion.x, alpha), lerp(companion.prevY, companion.y, alpha));
      visual.root.rotation = companion.angle;
      visual.glow.visible = this.settings.quality !== 'low';
      visual.glow.alpha = companion.shotCooldown > BALANCE.companion.interval - 0.08 ? 0.48 : 0.22;
      visual.barrel.alpha = companion.targetId === null ? 0.55 : 1;
    }
    for (let index = count; index < this.companions.length; index++) this.companions[index].root.visible = false;
  }

  private renderPlayerBeams(state: WorldState) {
    const graph = this.playerBeams.clear();
    for (const beam of state.beams) {
      const remaining = clamp(beam.life / beam.duration, 0, 1);
      if (remaining <= 0) continue;
      const fade = Math.sqrt(remaining), geometry = beamGeometry(beam.x, beam.y, beam.angle, beam.length, beam.width);
      const dx = Math.cos(beam.angle), dy = Math.sin(beam.angle), nx = -dy, ny = dx;
      // The full-width cyan body is the same rectangle used by the instantaneous piercing hit.
      graph.poly(geometry.corners).fill({ color: 0x62ffda, alpha: fade * 0.3 });
      graph.poly(geometry.corners).stroke({ color: 0x99ffee, width: 2, alpha: fade * 0.7 });
      graph.moveTo(beam.x, beam.y).lineTo(geometry.endX, geometry.endY)
        .stroke({ color: 0xabfff0, width: beam.width * (0.65 + remaining * 0.08), alpha: fade * 0.65 });
      graph.moveTo(beam.x, beam.y).lineTo(geometry.endX, geometry.endY)
        .stroke({ color: 0xf3fff9, width: beam.width * (0.2 + remaining * 0.32), alpha: fade });
      graph.moveTo(beam.x, beam.y).lineTo(geometry.endX, geometry.endY)
        .stroke({ color: 0xffffff, width: 5 + remaining * 7, alpha: fade });
      if (!this.settings.reducedMotion) {
        for (const sign of [-1, 1]) {
          const offset = sign * beam.width * 0.4;
          graph.moveTo(beam.x + nx * offset, beam.y + ny * offset)
            .lineTo(geometry.endX + nx * offset, geometry.endY + ny * offset).stroke({ color: 0xc5fff2, width: 3, alpha: remaining * 0.75 });
        }
        for (let ring = 0; ring < 3; ring++) {
          const distance = 30 + ring * 48 + (1 - remaining) * 95;
          const radius = beam.width * (0.6 - ring * 0.07);
          const points: number[] = [];
          for (let i = 0; i < 32; i++) {
            const theta = i * TAU / 32, along = Math.cos(theta) * 12, across = Math.sin(theta) * radius;
            points.push(beam.x + dx * (distance + along) + nx * across, beam.y + dy * (distance + along) + ny * across);
          }
          graph.poly(points).stroke({ color: 0xd7fff4, width: 2.5, alpha: remaining * (0.85 - ring * 0.2) });
        }
      }
    }
  }

  private renderPlayer(state: WorldState, alpha: number, dt: number) {
    const player = state.player;
    const x = lerp(player.prevX, player.x, alpha), y = lerp(player.prevY, player.y, alpha);
    this.playerLayer.position.set(x, y);
    const dashing = player.dashTime > 0, ready = player.perfectWindow > 0;
    const tilt = this.settings.reducedMotion ? 0 : clamp(player.vx / 300, -1, 1) * 0.075;
    this.playerArt.rotation = tilt; this.playerHit.rotation = tilt;
    this.playerArt.width = dashing ? 91 : 83; this.playerArt.height = dashing ? 75 : 83;
    this.playerHit.width = this.playerArt.width; this.playerHit.height = this.playerArt.height;
    this.playerHit.alpha = this.damage > 0.65 ? (this.damage - 0.65) * 1.6 : 0;
    this.playerArt.alpha = player.invincible > 0 && !dashing ? 0.68 + Math.sin(this.clock * 24) * 0.18 : 1;
    this.playerRing.tint = ready ? 0xffe8ac : dashing ? 0xc4ffef : 0x85f6dd;
    this.playerRing.rotation = this.settings.reducedMotion ? 0 : state.elapsed * 0.15;
    this.playerRing.width = ready ? 103 : 84; this.playerRing.height = this.playerRing.width;
    this.playerGlow.tint = ready ? 0xffd49a : 0x82ffe0; this.playerGlow.alpha = ready ? 0.35 : 0.19;
    this.playerGlow.visible = this.settings.quality !== 'low' || ready;
    this.trailClock -= dt;
    if (dashing && this.trailClock <= 0) { this.effects.trail(x, y, tilt); this.trailClock = 1 / 40; }
    const graph = this.playerMarks.clear();
    // The small ring is the actual hit circle; art and decorative rings never define damage.
    if (player.focus) graph.circle(x, y, player.radius).stroke({ color: 0x07101e, width: 5, alpha: 0.95 });
    graph.circle(x, y, player.radius).stroke({ color: WHITE, width: player.focus ? 2 : 1, alpha: player.focus || player.invincible > 0 ? 0.95 : 0.25 });
    graph.circle(x, y, 2.3).fill({ color: 0xf2fff8, alpha: 0.9 });
    const cos = Math.cos(player.angle), sin = Math.sin(player.angle), nx = -sin, ny = cos;
    const frontX = x + cos * 51, frontY = y + sin * 51;
    graph.poly([frontX + cos * 8, frontY + sin * 8, frontX - cos * 3 + nx * 4, frontY - sin * 3 + ny * 4,
      frontX - cos * 3 - nx * 4, frontY - sin * 3 - ny * 4]).fill(ready ? 0xffe6b3 : 0xb4ffed);
    if (player.dashCooldown > 0) {
      graph.moveTo(x, y - 39).arc(x, y, 39, -Math.PI / 2, -Math.PI / 2 + (1 - player.dashCooldown / BALANCE.dash.cooldown) * TAU)
        .stroke({ color: 0x98eedd, width: 2, alpha: 0.65 });
    }
    if (player.overheated || player.ammo < 20) {
      const color = player.overheated ? 0xffa46e : 0x8edbff;
      graph.roundRect(x - 24, y + 48, 48, 4, 2).fill({ color: 0x111523, alpha: 0.9 });
      graph.roundRect(x - 24, y + 48, Math.max(2, 48 * (player.overheated ? player.heat / 100 : player.ammo / 120)), 4, 2).fill(color);
    }
  }

  private sector(graph: Graphics, x: number, y: number, start: number, sweep: number, radius: number, color: number, alpha: number) {
    const points = [x, y];
    for (let i = 0; i <= 32; i++) {
      const angle = start + sweep * i / 32;
      points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    graph.poly(points).fill({ color, alpha });
    graph.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius).lineTo(x, y)
      .lineTo(x + Math.cos(start + sweep) * radius, y + Math.sin(start + sweep) * radius).stroke({ color, width: 1.5, alpha: Math.min(0.65, alpha * 7) });
  }

  private renderWarnings(state: WorldState, alpha: number) {
    const graph = this.warnings.clear();
    const attacks = bossAttacks(state.difficulty), enemyConfig = enemyAttacks(state.difficulty);
    for (const indicator of state.indicators) {
      if (!this.visible(indicator.x, indicator.y, 200)) continue;
      const progress = clamp(1 - indicator.time / indicator.duration, 0, 1);
      const color = ENEMIES[indicator.type].color;
      const radius = indicator.type === 'boss' ? 190 : ENEMIES[indicator.type].radius + 17;
      graph.circle(indicator.x, indicator.y, radius).fill({ color, alpha: 0.04 + progress * 0.06 }).stroke({ color, width: 1, alpha: 0.55 });
      graph.moveTo(indicator.x, indicator.y - radius - 7).arc(indicator.x, indicator.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * TAU).stroke({ color, width: 3, alpha: 0.9 });
      const inner = radius * (1 - progress * 0.7);
      graph.moveTo(indicator.x - inner, indicator.y).lineTo(indicator.x + inner, indicator.y)
        .moveTo(indicator.x, indicator.y - inner).lineTo(indicator.x, indicator.y + inner).stroke({ color, width: 1, alpha: 0.45 });
    }
    for (const enemy of state.enemies) {
      const x = lerp(enemy.prevX, enemy.x, alpha), y = lerp(enemy.prevY, enemy.y, alpha);
      if (enemy.type === 'miniboss' && enemy.miniboss) {
        const cfg = miniBossAttacks(state.difficulty), brain = enemy.miniboss;
        if (enemy.state === 'charge') {
          const length = Math.hypot(brain.targetX - enemy.x, brain.targetY - enemy.y);
          this.dashWarning(graph, x, y, enemy.angle, length, enemy.radius, 0xffae79, true);
        } else if (enemy.state === 'laserWarmup' || enemy.state === 'laser') {
          const beam = beamGeometry(x, y, enemy.angle, cfg.laser.length, cfg.laser.width), active = enemy.state === 'laser';
          graph.poly(beam.corners).fill({ color: 0xff9c66, alpha: active ? 0.72 : 0.14 }).stroke({ color: 0xffc9a5, width: active ? 3 : 2, alpha: 0.95 });
          graph.moveTo(x, y).lineTo(beam.endX, beam.endY).stroke({ color: 0xfff4dc, width: active ? cfg.laser.width * 0.24 : 1.5, alpha: 0.85 });
          if (!active) {
            const warning = brain.phase === 2 ? cfg.laser.phase2Warning : cfg.laser.warning;
            graph.moveTo(x, y - enemy.radius - 14).arc(x, y, enemy.radius + 14, -Math.PI / 2, -Math.PI / 2 + clamp(1 - enemy.timer / warning, 0, 1) * TAU).stroke({ color: 0xffd6ab, width: 4, alpha: 0.9 });
          }
        } else if (enemy.state === 'phaseShift') {
          graph.circle(x, y, enemy.radius + 20).stroke({ color: 0xffd0a4, width: 4, alpha: 0.8 });
        }
      } else if (enemy.type === 'boss' && (enemy.state === 'laserWarmup' || enemy.state === 'laser')) {
        this.renderLaser(graph, enemy, x, y, attacks);
      } else if (enemy.type === 'boss' && enemy.boss) {
        const brain = enemy.boss, phase = brain.phase - 1;
        if (enemy.state === 'novaWarmup' || enemy.state === 'nova') {
          const gap = attacks.nova.gap[phase], angle = brain.lockedAngle;
          this.sector(graph, x, y, angle + gap / 2, TAU - gap, 1150, 0xdd9bff, 0.045);
          this.sector(graph, x, y, angle - gap / 2, gap, 900, 0x88f4d6, 0.07);
          graph.circle(x, y, enemy.radius + 18).stroke({ color: 0xccafff, width: 3, alpha: 0.8 });
          for (let distance = 240; distance < 850; distance += 120) {
            const bx = x + Math.cos(angle) * distance, by = y + Math.sin(angle) * distance;
            graph.circle(bx, by, 4).fill({ color: 0xb4ffe6, alpha: 0.8 });
          }
        } else if (enemy.state === 'aim' || enemy.state === 'volley') {
          const spread = (attacks.volley.count[phase] - 1) * attacks.volley.angleStep;
          this.sector(graph, x, y, brain.lockedAngle - spread / 2, spread, 1400, 0xf5a0c9, 0.06);
          for (let i = 0; i < attacks.volley.count[phase]; i++) {
            const angle = brain.lockedAngle + (i - (attacks.volley.count[phase] - 1) / 2) * attacks.volley.angleStep;
            graph.moveTo(x, y).lineTo(x + Math.cos(angle) * 1400, y + Math.sin(angle) * 1400).stroke({ color: 0xffbad6, width: 1, alpha: 0.4 });
          }
        } else if (enemy.state === 'phaseShift') {
          const progress = 1 - enemy.timer / attacks.phaseShift;
          graph.circle(x, y, enemy.radius + 25 + progress * 20).stroke({ color: 0xe4d0ff, width: 3, alpha: 0.85 });
        }
      } else if (enemy.type === 'sniper' && (enemy.state === 'aim' || enemy.state === 'volley')) {
        const progress = clamp(1 - enemy.timer / enemyConfig.sniper.warning, 0, 1), locked = enemy.tactics?.locked ?? false;
        const beam = beamGeometry(x, y, enemy.angle, 6000, 5);
        graph.moveTo(x, y).lineTo(beam.endX, beam.endY).stroke({ color: locked ? 0xffb4db : 0xce99fc, width: locked ? 2.5 : 1.3, alpha: 0.25 + progress * 0.6 });
        graph.circle(x, y, enemy.radius + 10).stroke({ color: 0xf3b9ee, width: 2, alpha: 0.2 + progress * 0.65 });
      } else if (enemy.type === 'dasher' && enemy.state === 'charge') {
        this.dashWarning(graph, x, y, enemy.angle, enemyConfig.dasher.speed * enemyConfig.dasher.duration, enemy.radius, 0xffcc7c, enemy.tactics?.locked ?? false);
      } else if (enemy.type === 'sprayer' && (enemy.state === 'aim' || enemy.state === 'volley')) {
        this.sector(graph, x, y, enemy.angle - enemyConfig.sprayer.sector / 2, enemyConfig.sprayer.sector, 1400, 0xffb873, 0.055);
      } else if (enemy.type === 'minelayer' && (enemy.state === 'charge' || enemy.state === 'lay' || enemy.state === 'volley')) {
        graph.circle(x, y, enemy.radius + 14).stroke({ color: 0xffca7f, width: 2, alpha: 0.8 });
      } else if (enemy.type === 'mine' && enemy.state === 'arming') {
        const progress = clamp(1 - enemy.timer / enemyConfig.mine.arming, 0, 1);
        graph.moveTo(x, y - enemy.radius).arc(x, y, enemy.radius, -Math.PI / 2, -Math.PI / 2 + progress * TAU)
          .stroke({ color: 0xffcb76, width: 3, alpha: 0.8 });
      }
    }
    for (const hazard of state.hazards) {
      const { x, y, radius } = hazard;
      if (!this.visible(x, y, radius)) continue;
      const progress = 1 - hazard.warning / hazard.warningDuration;
      graph.circle(x, y, radius).fill({ color: 0xff725b, alpha: hazard.active ? 0.55 : 0.06 + progress * 0.09 });
      graph.circle(x, y, radius).stroke({ color: hazard.active ? 0xffefe0 : 0xffa380, width: hazard.active ? 4 : 2, alpha: 0.95 });
      if (!hazard.active) {
        graph.moveTo(x, y - radius).arc(x, y, radius + 5, -Math.PI / 2, -Math.PI / 2 + progress * TAU).stroke({ color: 0xffd2ad, width: 4, alpha: 0.9 });
        graph.moveTo(x - 10, y - 10).lineTo(x + 10, y + 10).moveTo(x + 10, y - 10).lineTo(x - 10, y + 10).stroke({ color: 0xffd2ad, width: 3, alpha: 0.8 });
      }
    }
    if (state.blackHoleTime > 0) {
      const { x, y } = state.player;
      const pulse = this.settings.reducedMotion ? 0 : Math.sin(state.elapsed * 3) * 10;
      graph.circle(x, y, 170 + pulse).fill({ color: 0x291540, alpha: 0.2 }).stroke({ color: 0xbcb3ff, alpha: 0.3, width: 2 });
      graph.circle(x, y, 245 + pulse).stroke({ color: 0x9782dd, alpha: 0.2, width: 1 });
    }
  }

  private dashWarning(graph: Graphics, x: number, y: number, angle: number, length: number, radius: number, color: number, locked: boolean) {
    const beam = beamGeometry(x, y, angle, length, radius * 2);
    const nx = -Math.sin(angle) * radius, ny = Math.cos(angle) * radius;
    graph.moveTo(x - nx, y - ny).lineTo(beam.endX - nx, beam.endY - ny)
      .arc(beam.endX, beam.endY, radius, angle - Math.PI / 2, angle + Math.PI / 2)
      .lineTo(x + nx, y + ny).arc(x, y, radius, angle + Math.PI / 2, angle + Math.PI * 1.5).closePath()
      .fill({ color, alpha: locked ? 0.16 : 0.07 }).stroke({ color, width: locked ? 2 : 1, alpha: locked ? 0.85 : 0.4 });
  }

  private renderLaser(graph: Graphics, enemy: Enemy, x: number, y: number, attacks: ReturnType<typeof bossAttacks>) {
    const active = enemy.state === 'laser';
    if (enemy.boss) {
      const start = enemy.boss.lockedAngle;
      const sweep = enemy.boss.sweepDirection * attacks.laser.angularSpeed * (attacks.laser.duration - attacks.laser.hold);
      this.sector(graph, x, y, start, sweep, attacks.laser.length, 0xe49de5, active ? 0.025 : 0.075);
      if (!active) {
        const endBeam = beamGeometry(x, y, start + sweep, attacks.laser.length, attacks.laser.width);
        graph.poly(endBeam.corners).fill({ color: 0xe49de5, alpha: 0.06 }).stroke({ color: 0xe49de5, width: 1, alpha: 0.4 });
      }
      const midpoint = start + sweep / 2, direction = enemy.boss.sweepDirection;
      for (const radius of [300, 490, 680]) {
        const bx = x + Math.cos(midpoint) * radius, by = y + Math.sin(midpoint) * radius;
        const tangent = midpoint + direction * Math.PI / 2;
        graph.moveTo(bx - Math.cos(tangent - 0.7) * 20, by - Math.sin(tangent - 0.7) * 20).lineTo(bx, by)
          .lineTo(bx - Math.cos(tangent + 0.7) * 20, by - Math.sin(tangent + 0.7) * 20).stroke({ color: 0xffcfed, width: 3, alpha: 0.8 });
      }
    }
    const beam = beamGeometry(x, y, enemy.angle, attacks.laser.length, attacks.laser.width);
    const progress = clamp(1 - enemy.timer / attacks.laser.warning, 0, 1);
    const locked = enemy.timer <= attacks.laser.warning;
    graph.poly(beam.corners).fill({ color: active ? 0xf695d9 : locked ? 0xfaacdc : 0xc49aff, alpha: active ? 0.66 : 0.07 + progress * 0.1 });
    graph.poly(beam.corners).stroke({ color: active ? 0xffd8f2 : 0xe2b5ff, width: active ? 3 : 2, alpha: active ? 1 : 0.5 + progress * 0.5 });
    if (active) {
      // White core stays inside the exact damage footprint. There is no wider decorative beam.
      graph.moveTo(x, y).lineTo(beam.endX, beam.endY).stroke({ color: 0xfff5fd, width: attacks.laser.width * 0.27, alpha: 0.85 });
      graph.moveTo(x, y).lineTo(beam.endX, beam.endY).stroke({ color: 0xffffff, width: 5, alpha: 1 });
    } else {
      graph.moveTo(x, y).lineTo(beam.endX, beam.endY).stroke({ color: 0xe0b8ff, width: 1, alpha: 0.4 });
      const dx = Math.cos(enemy.angle), dy = Math.sin(enemy.angle), nx = -dy, ny = dx;
      for (let distance = 220; distance < 1800; distance += 160) {
        const bx = x + dx * distance, by = y + dy * distance;
        graph.moveTo(bx - dx * 13 + nx * 12, by - dy * 13 + ny * 12).lineTo(bx, by)
          .lineTo(bx - dx * 13 - nx * 12, by - dy * 13 - ny * 12).stroke({ color: 0xedc9ff, width: 2, alpha: 0.25 + progress * 0.45 });
      }
    }
  }

  private renderOverlay(state: WorldState) {
    const ambient = this.ambient.clear();
    if (this.settings.quality !== 'low') {
      for (let index = 0; index < QUALITY[this.settings.quality].stars; index++) {
        const star = this.stars[index];
        const drift = this.settings.reducedMotion ? 0 : this.clock * 3;
        const y = (star.y - drift % VIEW.height + VIEW.height) % VIEW.height;
        const opacity = 0.08 + (Math.sin(this.clock * 0.7 + star.phase) + 1) * 0.035;
        ambient.circle(star.x, y, index % 7 === 0 ? 1.8 : 0.85).fill({ color: index % 2 ? 0xbec1e9 : 0xadffe9, alpha: opacity });
      }
    }
    const graph = this.overlay.clear();
    const dangerous = state.enemies.some(enemy => enemy.type === 'boss' && enemy.state === 'laserWarmup');
    const warning = Math.max(this.warning, dangerous ? 0.22 : 0);
    // A cached gradient gives soft edge feedback without full-screen blur filters.
    this.damageEdge.alpha = this.damage * (this.settings.reducedMotion ? 0.18 : 0.34);
    this.warningEdge.alpha = warning * 0.24;
    this.flashEdge.alpha = this.flash * (this.settings.reducedMotion ? 0.15 : 0.3);
    this.damageEdge.visible = this.damage > 0; this.warningEdge.visible = warning > 0; this.flashEdge.visible = this.flash > 0;
    if (this.pointer.inside && state.status === 'playing') {
      const x = this.pointer.x + this.world.x - (VIEW.width / 2 - this.cameraX);
      const y = this.pointer.y + this.world.y - (VIEW.height / 2 - this.cameraY);
      const color = state.player.overheated ? 0xffae82 : state.player.perfectWindow > 0 ? 0xffe5a9 : 0xc4ffed;
      graph.circle(x, y, 9).stroke({ color: 0x101927, width: 4, alpha: 0.8 });
      graph.circle(x, y, 9).stroke({ color, width: 1, alpha: 0.8 });
      graph.circle(x, y, 1.8).fill(color);
      for (let i = 0; i < 4; i++) {
        const angle = i * TAU / 4;
        graph.moveTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14)
          .lineTo(x + Math.cos(angle) * 19, y + Math.sin(angle) * 19).stroke({ color, width: 1.5, alpha: 0.85 });
      }
    }
  }

  handleEvents(events: CombatEvent[]) {
    if (!this.initialized) return;
    for (const event of events) {
      this.effects.handle(event);
      if (event.type === 'damage') { this.damage = 1; this.shake = Math.max(this.shake, 18); }
      if (event.type === 'bomb') { this.flash = 1; this.shake = Math.max(this.shake, 24); }
      if (event.type === 'dash') this.shake = Math.max(this.shake, 3);
      if (event.type === 'beam') this.shake = Math.max(this.shake, 9);
      if (event.type === 'kill') this.shake = Math.max(this.shake, event.enemyType === 'boss' ? 24 : 1.5);
      if (event.type === 'boss' || (event.type === 'attack' && event.enemyType === 'boss' && event.text !== 'impact')) this.warning = 1;
      if (event.type === 'attack' && event.text === 'impact') this.shake = Math.max(this.shake, 4);
    }
  }

  resetEffects() {
    if (!this.initialized) return;
    this.effects.reset();
    this.shake = 0; this.damage = 0; this.flash = 0; this.warning = 0; this.trailClock = 0;
    for (const [id, visual] of this.enemies) { visual.root.visible = false; visual.hazard.visible = false; this.enemyFree.push(visual); this.enemies.delete(id); }
    for (const [id, visual] of this.pickups) { visual.root.visible = false; this.pickupFree.push(visual); this.pickups.delete(id); }
    for (const visual of this.bullets) { visual.effect.visible = false; visual.core.visible = false; }
    for (const visual of this.companions) visual.root.visible = false;
    this.playerBeams.clear(); this.pickupHint.visible = false;
  }

  getStats() { return { particles: this.initialized ? this.effects.count : 0, textures: this.initialized ? 14 + this.generated.length + this.effects.labelTextureCount : 0 }; }
  debugStress() { if (this.initialized) this.effects.debugStress(this.cameraX, this.cameraY); }

  destroy() {
    this.disposed = true;
    if (!this.appReady) return;
    this.app.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.app.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.effects?.destroy();
    this.app.destroy(true, { children: true });
    for (const texture of this.generated) texture.destroy(true);
    for (const texture of Object.values(this.assets ?? {})) texture.destroy(true);
    for (const texture of Object.values(this.supportAssets ?? {})) texture.destroy(true);
    this.generated.length = 0; this.enemies.clear(); this.enemyFree.length = 0; this.pickups.clear(); this.pickupFree.length = 0; this.bullets.length = 0; this.companions.length = 0;
    this.initialized = false;
    this.appReady = false;
  }
}
