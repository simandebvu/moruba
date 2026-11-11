/**
 * Small synthesised sound effects (Web Audio, no asset files): a wooden clack
 * for each seed, plus lift, capture, deny and game-over cues. Placeholder
 * until the recorded audio pass.
 */

export class Sounds {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastClack = 0;

  /** Browsers only allow audio after a user gesture; call from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      const length = Math.floor(this.ctx.sampleRate * 0.08);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      // Deterministic noise: a simple LCG, so the sound is the same every run.
      let seed = 12345;
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
    } catch {
      this.ctx = null;
    }
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** One seed landing; `fill` (seeds now in the pit) nudges the pitch. */
  clack(fill = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    // When fast-forwarding, do not stack dozens of clicks in one instant.
    if (ctx.currentTime - this.lastClack < 0.025) return;
    this.lastClack = ctx.currentTime;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500 + Math.min(fill, 8) * 110;
    filter.Q.value = 5;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.5, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    source.connect(filter).connect(amp).connect(ctx.destination);
    source.start(t);
    this.tone(210 + Math.min(fill, 8) * 12, 0.05, 0.18);
  }

  lift(): void {
    this.tone(520, 0.08, 0.08, 'triangle');
  }

  capture(): void {
    this.tone(392, 0.16, 0.16, 'triangle');
    this.tone(587, 0.22, 0.16, 'triangle', 0.09);
  }

  deny(): void {
    this.tone(150, 0.12, 0.14, 'square');
  }

  gameOver(): void {
    this.tone(392, 0.2, 0.15, 'triangle');
    this.tone(494, 0.2, 0.15, 'triangle', 0.16);
    this.tone(587, 0.4, 0.15, 'triangle', 0.32);
  }
}
