/**
 * Sound effects, synthesised with Web Audio (no asset files).
 *
 * The sounds are modelled, not recorded: a seed on wood is a short click
 * exciting a few fast-decaying resonances (the way a struck wooden bowl
 * rings), a handful of seeds is a scatter of tiny bright ticks, and the reward
 * cues are plucked tines in the manner of an mbira. Every hit varies a little
 * in pitch and level so repeats do not sound mechanical.
 */

/** Resonances of a small wooden bowl, as multiples of its lowest one, with decay times. */
const WOOD_MODES: readonly [ratio: number, seconds: number, level: number][] = [
  [1, 0.07, 1],
  [2.76, 0.045, 0.55],
  [5.4, 0.028, 0.3],
  [8.9, 0.018, 0.16],
];

/** A five-note scale (as ratios) for the climbing notes of a long sow. */
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];

export class Sounds {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastClack = 0;
  private lastTick = 0;
  private lastCapture = 0;

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      // A gentle limiter so a burst of hits never clips.
      const squash = ctx.createDynamicsCompressor();
      squash.threshold.value = -14;
      squash.ratio.value = 6;
      squash.attack.value = 0.002;
      squash.release.value = 0.12;
      this.out = ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(squash).connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate * 0.25);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  /** A decaying sine: one resonance of something struck. */
  private ring(frequency: number, seconds: number, level: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = frequency;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(amp).connect(this.out);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  /** A burst of filtered noise: the contact itself. */
  private click(
    frequency: number,
    q: number,
    seconds: number,
    level: number,
    at: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(level, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    source.connect(filter).connect(amp).connect(this.out);
    source.start(at, Math.random() * 0.2);
    source.stop(at + seconds + 0.02);
  }

  /** Something hard hitting wood. `base`: lowest resonance in Hz. */
  private knock(base: number, level: number, at: number, bright = 1): void {
    const pitch = base * (0.94 + Math.random() * 0.12);
    for (const [ratio, seconds, weight] of WOOD_MODES) {
      this.ring(pitch * ratio, seconds, level * weight * 0.5, at);
    }
    this.click(2600 * bright, 1.2, 0.012, level * 0.7, at);
  }

  /** A seed touching other seeds: small, dry and bright. */
  private tick(level: number, at: number): void {
    const pitch = 3200 + Math.random() * 2600;
    this.click(pitch, 9, 0.022, level, at);
    this.ring(pitch * 0.5, 0.012, level * 0.12, at);
  }

  /** A plucked tine. */
  private tine(frequency: number, level: number, at: number, seconds = 0.9): void {
    this.ring(frequency, seconds, level, at);
    this.ring(frequency * 2.01, seconds * 0.5, level * 0.3, at);
    this.ring(frequency * 5.3, 0.06, level * 0.2, at);
    this.click(frequency * 3, 3, 0.01, level * 0.4, at);
  }

  /** One seed landing; `fill` is how many seeds are now in the pit. */
  clack(fill = 1, step = -1, low = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // When fast-forwarding, do not stack dozens of hits in one instant.
    if (ctx.currentTime - this.lastClack < 0.022) return;
    this.lastClack = ctx.currentTime;
    const t = ctx.currentTime;
    // An empty pit rings as wood; a fuller one is mostly seed on seed.
    const wood = 1 / (1 + Math.max(0, fill - 1) * 0.55);
    this.knock(330 + Math.random() * 30, 0.5 * wood + 0.08, t, 1 + (1 - wood) * 0.4);
    if (fill > 1) {
      this.tick(0.5 * (1 - wood) + 0.12, t + 0.004);
      if (fill > 3) this.tick(0.22, t + 0.018 + Math.random() * 0.012);
    }
    // Each seed of a move sounds a step higher, so a long run climbs.
    if (step >= 0) {
      const climb = Math.min(step, 14);
      const note = SCALE[climb % 5] * 2 ** Math.floor(climb / 5);
      this.tine((low ? 147 : 294) * note, 0.07 + Math.min(step, 14) * 0.004, t, 0.35);
    }
  }

  /** Seeds scooped out of a pit into the hand. */
  lift(count = 2): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const ticks = Math.min(7, 2 + count);
    for (let i = 0; i < ticks; i++) {
      this.tick(0.16 + Math.random() * 0.14, t + i * 0.016 + Math.random() * 0.01);
    }
    this.knock(250, 0.1, t + 0.01);
  }

  /** A capture: a weighty knock on the board, then a bright two-note call. */
  capture(size = 2): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Two pits taken at once are one hit, not two on top of each other.
    if (ctx.currentTime - this.lastCapture < 0.08) return;
    this.lastCapture = ctx.currentTime;
    const t = ctx.currentTime;
    const big = Math.min(1, size / 8);
    this.knock(150 - big * 50, 0.7 + big * 0.3, t, 0.6);
    this.ring(75 - big * 20, 0.16 + big * 0.2, 0.45 + big * 0.3, t);
    this.tine(587.3, 0.22, t + 0.05, 0.7);
    this.tine(880, 0.2, t + 0.17, 0.9);
    if (size >= 4) this.tine(1174.7, 0.18, t + 0.29, 1.1);
    if (size >= 7) {
      this.tine(1760, 0.16, t + 0.41, 1.4);
      this.tine(440, 0.16, t + 0.41, 1.6);
    }
  }

  /** A captured seed arriving in the tray. */
  trayHit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.currentTime - this.lastTick < 0.018) return;
    this.lastTick = ctx.currentTime;
    const t = ctx.currentTime;
    this.knock(520 + Math.random() * 120, 0.3, t, 1.3);
    this.tick(0.2, t + 0.006);
  }

  /** Not allowed: a dull, damped thud. */
  deny(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.ring(110, 0.09, 0.4, t);
    this.click(400, 1, 0.03, 0.25, t);
  }

  /** A soft tine, for stepping through the lesson and pressing buttons. */
  step(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tine(659.3, 0.12, ctx.currentTime, 0.4);
  }

  gameOver(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [392, 493.9, 587.3, 784];
    notes.forEach((note, i) => this.tine(note, 0.22, t + i * 0.16, 1.2));
    this.tine(392, 0.14, t + 0.64, 1.6);
  }
}
