/** Capacity belongs to an attack from its warning until the last promised release. */
export class AttackBudget {
  private readonly reservations = new Map<number, { bullets: number; hazards: number; expires: number }>();
  constructor(readonly bulletLimit: number, readonly hazardLimit: number) {}
  reset(): void { this.reservations.clear(); }
  cancel(source: number): void { this.reservations.delete(source); }
  expire(now: number): void {
    for (const [source, reservation] of this.reservations) if (reservation.expires < now) this.reservations.delete(source);
  }
  get reservedBullets(): number { let count = 0; for (const value of this.reservations.values()) count += value.bullets; return count; }
  get reservedHazards(): number { let count = 0; for (const value of this.reservations.values()) count += value.hazards; return count; }
  get sources(): number { return this.reservations.size; }
  reserve(source: number, bullets: number, hazards: number, duration: number, now: number, liveBullets: number, liveHazards: number): boolean {
    this.expire(now);
    if (![bullets, hazards, duration].every(Number.isFinite) || bullets < 0 || hazards < 0 || duration < 0) return false;
    bullets = Math.ceil(bullets); hazards = Math.ceil(hazards);
    if (liveBullets + this.reservedBullets + bullets > this.bulletLimit || liveHazards + this.reservedHazards + hazards > this.hazardLimit) return false;
    if (bullets || hazards) {
      const old = this.reservations.get(source);
      this.reservations.set(source, { bullets: (old?.bullets ?? 0) + bullets, hazards: (old?.hazards ?? 0) + hazards, expires: Math.max(old?.expires ?? 0, now + duration) });
    }
    return true;
  }
  take(source: number | undefined, kind: 'bullets' | 'hazards', live: number): boolean {
    const reserved = source === undefined ? undefined : this.reservations.get(source);
    const limit = kind === 'bullets' ? this.bulletLimit : this.hazardLimit;
    if (live >= limit) return false;
    if (reserved && reserved[kind] > 0) {
      reserved[kind]--;
      if (!reserved.bullets && !reserved.hazards) this.reservations.delete(source!);
      return true;
    }
    return live + (kind === 'bullets' ? this.reservedBullets : this.reservedHazards) < limit;
  }
}
