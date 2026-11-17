// HUD for SOLMAR: cash, wanted stars, objective line, speed, health/heat
// bars, the circular minimap (north-up, player + police + mission marker +
// traffic + parked cars), toasts, combo pops, the phone job list and the
// results screen. All DOM — the 3D scene never draws UI itself.
import { formatCash, formatTime, formatClock, clamp } from './rng.js';
import { CITY } from './city.js';
import { MISSIONS } from './state.js';

export class Hud {
  constructor(state, bus) {
    this.state = state; this.bus = bus;
    this.el = {
      hud: document.getElementById('hud'),
      cash: document.getElementById('cash'),
      wanted: document.getElementById('wanted-row'),
      objTitle: document.getElementById('objective-title'),
      objText: document.getElementById('objective-text'),
      objDist: document.getElementById('objective-dist'),
      speed: document.getElementById('speed'),
      gear: document.getElementById('gear'),
      radio: document.getElementById('radio'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      heatFill: document.getElementById('heat-fill'),
      clock: document.getElementById('clock'),
      hint: document.getElementById('hint-line'),
      toast: document.getElementById('center-toast'),
      combo: document.getElementById('combo-pop'),
      damage: document.getElementById('damage-flash'),
      minimap: document.getElementById('minimap'),
      phone: document.getElementById('phone'),
      jobList: document.getElementById('job-list'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this.comboTimer = null;
    this.world = null; // {player, traffic, police, missions, city}
    this.bus.on('toast', (msg) => this.toast(typeof msg === 'string' ? msg : msg.text));
    this.bus.on('combo', (c) => this.comboPop(c));
    this.bus.on('near-miss', (n) => this.comboPop({ kind: 'NEAR MISS', combo: this.state.s.combo, bonus: n.bonus }));
    this.bus.on('stunt', (n) => this.comboPop({ kind: 'STUNT +' + n.bonus, combo: this.state.s.combo }));
    this.bus.on('damage', () => this.flashDamage());
    this.bus.on('hint', (h) => this.setHint(typeof h === 'string' ? h : h.text));
  }
  setWorld(world) { this.world = world; }
  showHud(v) { this.el.hud.classList.toggle('hidden', !v); }
  toast(text, ms) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms || 2400);
  }
  comboPop(c) {
    const label = (c.kind || 'COMBO').toUpperCase();
    const bonus = c.bonus ? '  +$' + c.bonus : '';
    this.el.combo.textContent = label + ' ×' + Math.max(1, c.combo) + bonus;
    this.el.combo.style.opacity = 1;
    clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => { this.el.combo.style.opacity = 0; }, 1600);
  }
  flashDamage() {
    this.el.damage.style.opacity = 1;
    setTimeout(() => { this.el.damage.style.opacity = 0; }, 180);
  }
  setHint(text) {
    this.el.hint.textContent = text;
    setTimeout(() => { if (this.el.hint.textContent === text) this.el.hint.textContent = ''; }, 4000);
  }
  renderPhone(missionSystem, onTake) {
    const list = this.el.jobList;
    list.innerHTML = '';
    for (const m of missionSystem.availableMissions()) {
      const card = document.createElement('div');
      card.className = 'job-card' + (m.done ? ' done' : '') + (m.locked ? ' locked' : '');
      const status = m.done ? '✓ DONE' : m.locked ? '🔒 FINISH THE PREVIOUS JOB' : 'OPEN';
      card.innerHTML = '<div class="job-name">' + (m.index + 1) + '. ' + m.def.name +
        '<span class="job-pay">' + formatCash(m.def.pay) + '</span></div>' +
        '<div class="job-desc">' + m.def.objective + '</div>' +
        '<div class="job-meta">' + status + ' · ' + formatTime(m.def.timeLimit) + ' LIMIT · ' + m.def.wantedStart + '★ START</div>';
      if (!m.done && !m.locked) {
        card.addEventListener('click', () => onTake(m.index));
      }
      list.appendChild(card);
    }
  }
  openPhone(v) { this.el.phone.classList.toggle('hidden', !v); }
  phoneOpen() { return !this.el.phone.classList.contains('hidden'); }
  update(missionSystem) {
    const s = this.state.s;
    this.el.cash.textContent = formatCash(s.cash);
    let stars = '';
    for (let i = 0; i < 5; i++) stars += '<span class="star' + (i < s.wanted ? '' : ' off') + '">★</span>';
    this.el.wanted.innerHTML = stars;
    this.el.speed.textContent = Math.round(s.speedMph);
    this.el.gear.textContent = s.gear;
    this.el.healthFill.style.width = clamp(s.onFoot ? s.playerHealth : s.carHealth, 0, 100) + '%';
    this.el.healthText.textContent = (s.onFoot ? 'YOU ' : 'CAR ') + Math.round(s.onFoot ? s.playerHealth : s.carHealth) + '%';
    this.el.heatFill.style.width = clamp(s.heat, 0, 100) + '%';
    this.el.clock.textContent = formatClock(s.timeMinutes) + ' · GOLDEN HOUR';
    const stations = ['SOLMAR FM', 'NEON NIGHTS', 'HARBOR BLUES', 'PALM STATIC'];
    this.el.radio.textContent = 'RADIO · ' + stations[s.radioStation % stations.length] + (s.radioOn ? '' : ' (OFF)');
    // Objective line.
    if (missionSystem.current) {
      const def = missionSystem.current.def;
      const stage = missionSystem.stageName();
      this.el.objTitle.textContent = def.name + ' — ' + formatTime(Math.max(0, missionSystem.current.timer));
      this.el.objText.textContent = def.objective;
      const target = missionSystem.stageTarget();
      if (target && this.world && this.world.player) {
        const d = Math.hypot(target.x - this.world.player.pos.x, target.z - this.world.player.pos.z);
        this.el.objDist.textContent = Math.round(d) + ' m · ' + stage.replace(/-/g, ' ').toUpperCase();
      } else this.el.objDist.textContent = '';
    } else {
      this.el.objTitle.textContent = 'FREE ROAM';
      this.el.objText.textContent = s.completedMissions.length >= 6
        ? 'Every job done. Solmar is yours — keep driving, or start over.'
        : 'Open the phone (M) to take a job from Marisol.';
      this.el.objDist.textContent = s.completedMissions.length + '/6 JOBS DONE';
    }
    this.drawMinimap(missionSystem);
  }
  drawMinimap(missionSystem) {
    const ctx = this.mapCtx;
    const W = 220, H = 220, half = CITY.half;
    const w = this.world;
    const px = w && w.player ? w.player.pos.x : 0;
    const pz = w && w.player ? w.player.pos.z : 0;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#12283d'; ctx.fillRect(0, 0, W, H);
    const toMap = (x, z) => [W / 2 + (x / half) * (W / 2 - 6), H / 2 + (z / half) * (H / 2 - 6)];
    // Water strip at the south edge.
    ctx.fillStyle = '#1d5f7a';
    ctx.fillRect(0, H - 16, W, 16);
    // Roads.
    ctx.strokeStyle = 'rgba(200,200,210,0.35)'; ctx.lineWidth = 5;
    const p = CITY.block;
    for (let i = -3; i <= 3; i++) {
      const [ax] = toMap(i * p, 0);
      ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, H); ctx.stroke();
      const [, bz] = toMap(0, i * p);
      ctx.beginPath(); ctx.moveTo(0, bz); ctx.lineTo(W, bz); ctx.stroke();
    }
    // Landmarks.
    ctx.fillStyle = '#ffd23d';
    for (const key of Object.keys(CITY.landmarks)) {
      const lm = CITY.landmarks[key];
      const [lx, lz] = toMap(lm.x, lm.z);
      ctx.fillRect(lx - 2, lz - 2, 4, 4);
    }
    // Mission marker.
    if (missionSystem.current) {
      const t = missionSystem.stageTarget();
      if (t) {
        const [mx, mz] = toMap(t.x, t.z);
        const pulse = 6 + Math.sin(performance.now() / 200) * 2;
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath(); ctx.arc(mx, mz, pulse, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a0f2e';
        ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Traffic cars.
    if (w && w.traffic) {
      ctx.fillStyle = '#8ec9ff';
      for (const c of w.traffic.cars) {
        if (c.taken) continue;
        const [cx, cz] = toMap(c.pos.x, c.pos.z);
        ctx.fillRect(cx - 1.5, cz - 1.5, 3, 3);
      }
    }
    // Police.
    if (w && w.police) {
      ctx.fillStyle = '#ff5e5e';
      for (const c of w.police.cruisers) {
        const [cx, cz] = toMap(c.pos.x, c.pos.z);
        ctx.beginPath(); ctx.arc(cx, cz, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Player arrow.
    const [ux, uy] = toMap(px, pz);
    const heading = w && w.player ? w.player.heading : 0;
    ctx.save();
    ctx.translate(ux, uy); ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#7dff5e';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // North tick.
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 13);
    ctx.restore();
  }
  showResults(result, stats, title, sub) {
    const screen = document.getElementById('results-screen');
    document.getElementById('results-title').textContent = title;
    document.getElementById('results-sub').textContent = sub;
    const rows = [
      ['Cash', formatCash(stats.cash)],
      ['Total earned', formatCash(stats.earned)],
      ['Jobs completed', stats.missions + ' / 6'],
      ['Distance driven', stats.distanceDriven + ' m'],
      ['Near misses', stats.nearMisses],
      ['Stunts', stats.stunts],
      ['Cars stolen', stats.carsStolen],
      ['Best combo', '×' + stats.bestCombo],
    ];
    document.getElementById('results-stats').innerHTML = rows.map(r => '<div>' + r[0] + '<b>' + r[1] + '</b></div>').join('');
    screen.classList.remove('hidden');
  }
  hideResults() { document.getElementById('results-screen').classList.add('hidden'); }
  showPause(stats) {
    const el = document.getElementById('pause-stats');
    el.innerHTML = 'Cash ' + formatCash(stats.cash) + ' · Jobs ' + stats.missions + '/6 · Earned ' + formatCash(stats.earned) + '<br>Near misses ' + stats.nearMisses + ' · Stunts ' + stats.stunts + ' · Distance ' + stats.distanceDriven + ' m';
    document.getElementById('pause-screen').classList.remove('hidden');
  }
  hidePause() { document.getElementById('pause-screen').classList.add('hidden'); }
  showTitle(canContinue) {
    document.getElementById('title-screen').classList.remove('hidden');
    document.getElementById('btn-continue').style.display = canContinue ? '' : 'none';
  }
  hideTitle() { document.getElementById('title-screen').classList.add('hidden'); }
}
