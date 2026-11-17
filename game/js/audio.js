// Procedural audio for SOLMAR: no audio files, everything is synthesized
// with WebAudio — engine hum that follows speed, two-tone police sirens,
// skid noise, crash thuds, cash-register chimes, and four switchable radio
// stations built from small sequenced chord loops. Audio starts only after
// a user gesture (the browser requires it); headless runs stay silent.
import { RADIO_STATIONS } from './state.js';
import { clamp } from './rng.js';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export class AudioEngine {
  constructor(state, bus) {
    this.state = state; this.bus = bus;
    this.ctx = null; this.master = null;
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenTimer = 0;
    this.radioTimer = null; this.radioStep = 0; this.radioNodes = [];
    this.skidSrc = null; this.skidGain = null;
    this.started = false;
    this.bus.on('mission-complete', () => this.chime([523, 659, 784, 1046]));
    this.bus.on('mission-failed', () => this.chime([392, 330, 262]));
    this.bus.on('crash', () => this.thud());
    this.bus.on('near-miss', () => this.blip(880, 0.08));
    this.bus.on('stunt', () => this.chime([659, 880]));
    this.bus.on('wanted', (w) => { if (w.level >= 1) this.blip(520, 0.15); });
    this.bus.on('rammed', () => this.thud());
    this.bus.on('heli', (h) => { if (h.on) this.blip(1200, 0.3); });
  }
  ensure() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Engine: two detuned saws through a lowpass, pitch follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sawtooth'; osc2.frequency.value = 55.5;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter); osc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start(); osc2.start();
      this.engineOsc2 = osc2;
      // Siren: a sine that alternates two tones.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine'; this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      // Skid: looped filtered noise.
      const len = this.ctx.sampleRate * 1;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.skidSrc = this.ctx.createBufferSource();
      this.skidSrc.buffer = buf; this.skidSrc.loop = true;
      const skidFilter = this.ctx.createBiquadFilter();
      skidFilter.type = 'bandpass'; skidFilter.frequency.value = 900; skidFilter.Q.value = 1.2;
      this.skidGain = this.ctx.createGain(); this.skidGain.gain.value = 0;
      this.skidSrc.connect(skidFilter); skidFilter.connect(this.skidGain); this.skidGain.connect(this.master);
      this.skidSrc.start();
      this.started = true;
      this.startRadio();
    } catch (e) { console.warn('audio unavailable', e); }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  note(freq, time, dur, type, gain) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(); o.type = type || 'triangle'; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain || 0.12, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g); g.connect(this.master);
    o.start(time); o.stop(time + dur + 0.05);
    this.radioNodes.push(o);
  }
  chime(freqs) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((f, i) => this.note(f, t0 + i * 0.09, 0.5, 'sine', 0.16));
  }
  blip(freq, dur) {
    if (!this.ctx) return;
    this.note(freq, this.ctx.currentTime, dur || 0.1, 'square', 0.06);
  }
  thud() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.35);
  }
  startRadio() {
    if (this.radioTimer) return;
    this.radioTimer = setInterval(() => this.radioStepFn(), 220);
  }
  radioStepFn() {
    if (!this.ctx || !this.started) return;
    const s = this.state.s;
    if (!s.radioOn || s.muted) { this.radioStep++; return; }
    const station = RADIO_STATIONS[s.radioStation % RADIO_STATIONS.length];
    const scale = SCALES[station.mode];
    const stepDur = 60 / station.bpm / 2;
    const t = this.ctx.currentTime + 0.05;
    const step = this.radioStep++;
    const chordRoots = [0, 5, 3, 4];
    const chord = chordRoots[Math.floor(step / 8) % chordRoots.length];
    // Bass on the beat.
    if (step % 2 === 0) {
      const deg = scale[(chord + (step % 8 === 6 ? 4 : 0)) % scale.length];
      this.note(station.root * Math.pow(2, deg / 12) / 2, t, stepDur * 1.8, 'sine', 0.14);
    }
    // Plucked melody, sparse.
    if (step % 4 === 1 || step % 4 === 3) {
      const deg = scale[(chord + 2 + ((step * 7) % 5)) % scale.length];
      this.note(station.root * Math.pow(2, deg / 12), t, stepDur, 'triangle', 0.05);
    }
    // Hat tick.
    if (step % 2 === 1) this.note(6000, t, 0.03, 'square', 0.012);
  }
  cycleStation() {
    const s = this.state.s;
    s.radioStation = (s.radioStation + 1) % RADIO_STATIONS.length;
    this.bus.emit('toast', 'Radio: ' + RADIO_STATIONS[s.radioStation].name);
  }
  update(dt, player) {
    if (!this.ctx || !this.started) return;
    const s = this.state.s;
    // Engine follows the car's speed note.
    const target = player && player.inCar ? 0.05 + player.engineNote * 0.075 : 0;
    this.engineGain.gain.setTargetAtTime(s.muted ? 0 : target, this.ctx.currentTime, 0.08);
    const freq = 52 + (player ? player.engineNote * 95 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.007, this.ctx.currentTime, 0.06);
    this.engineFilter.frequency.setTargetAtTime(380 + (player ? player.engineNote * 900 : 0), this.ctx.currentTime, 0.1);
    // Skid when drifting at speed.
    const skidding = player && player.inCar && player.drift > 0.4 && Math.abs(player.speed) > 14;
    this.skidGain.gain.setTargetAtTime(skidding && !s.muted ? 0.09 : 0, this.ctx.currentTime, 0.05);
    // Siren: two-tone wail while any wanted level is active.
    this.sirenTimer += dt;
    const sirenOn = s.wanted >= 1 && !s.muted;
    const tone = Math.sin(this.sirenTimer * 2.4) > 0 ? 720 : 540;
    this.sirenOsc.frequency.setTargetAtTime(tone, this.ctx.currentTime, 0.05);
    this.sirenGain.gain.setTargetAtTime(sirenOn ? 0.035 : 0, this.ctx.currentTime, 0.2);
  }
}
