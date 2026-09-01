/* ════════════════════════════════════════════════
   BoostCore - Haltech/MoTeC Motorsport Telemetry
   app.js - Gauges, W-Key Throttle, OBD Boilerplate
   ════════════════════════════════════════════════ */

'use strict';

/* ── Arc Gauge Class (Canvas) ──────────────────── */
class ArcGauge {
    constructor(canvasId, opts = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.min = opts.min ?? 0;
        this.max = opts.max ?? 100;
        this.value = opts.value ?? 0;
        this.color = opts.color ?? '#00d084';
        this.bgColor = '#0a0d12';
        this.warn = opts.warn ?? null;   // yellow warn threshold
        this.crit = opts.crit ?? null;   // red critical threshold
        this.critLow = opts.critLow ?? null;   // red critical below this

        this._current = this.value;
        this._target = this.value;

        this._animate = this._animate.bind(this);
        requestAnimationFrame(this._animate);
    }

    setValue(v) {
        this._target = Math.max(this.min, Math.min(this.max, v));
    }

    _colorForValue(v) {
        if (this.crit !== null && v >= this.crit) return '#ff2244';
        if (this.critLow !== null && v <= this.critLow) return '#ff2244';
        if (this.warn !== null && v >= this.warn) return '#f0c000';
        return this.color;
    }

    draw() {
        const { ctx, canvas } = this;
        const W = canvas.width;
        const H = canvas.height;
        const cx = W / 2;
        const cy = H / 2;
        const R = W / 2 - 14;
        const lineW = 10;
        const startA = Math.PI * 0.72;
        const endA = Math.PI * 2.28;
        const span = endA - startA;

        ctx.clearRect(0, 0, W, H);

        // ── Track (background arc) ──
        ctx.beginPath();
        ctx.arc(cx, cy, R, startA, endA);
        ctx.lineWidth = lineW;
        ctx.strokeStyle = this.bgColor;
        ctx.lineCap = 'round';
        ctx.stroke();

        // ── Tick marks ──
        const ticks = 8;
        for (let i = 0; i <= ticks; i++) {
            const a = startA + (span / ticks) * i;
            const inner = R - 7;
            const outer = R + 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.stroke();
        }

        // ── Value arc ──
        const pct = (this._current - this.min) / (this.max - this.min);
        const fillAngle = startA + span * pct;
        const activeColor = this._colorForValue(this._current);

        if (pct > 0.005) {
            ctx.beginPath();
            ctx.arc(cx, cy, R, startA, fillAngle);
            ctx.lineWidth = lineW;
            ctx.strokeStyle = activeColor;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 14;
            ctx.shadowColor = activeColor;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Bright tip dot
            const tipX = cx + Math.cos(fillAngle) * R;
            const tipY = cy + Math.sin(fillAngle) * R;
            ctx.beginPath();
            ctx.arc(tipX, tipY, lineW / 2 + 1, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 8;
            ctx.shadowColor = activeColor;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    _animate() {
        const diff = this._target - this._current;
        this._current += diff * 0.12;
        this.draw();
        requestAnimationFrame(this._animate);
    }
}

/* ── Build RPM Segment Dividers ────────────────── */
(function buildRpmDividers() {
    const container = document.getElementById('rpm-seg-dividers');
    for (let i = 0; i < 16; i++) {
        const s = document.createElement('span');
        container.appendChild(s);
    }
})();

/* ── Gauge Instances ────────────────────────────── */
const boostGauge = new ArcGauge('boostGauge', {
    min: -14, max: 28, value: 0,
    color: '#0096ff',
    warn: 14,
    crit: 22
});
const oilGauge = new ArcGauge('oilGauge', {
    min: 0, max: 120, value: 60,
    color: '#f0c000',
    crit: 90,
    critLow: 20
});
const tempGauge = new ArcGauge('tempGauge', {
    min: 20, max: 130, value: 20,
    color: '#00d084',
    warn: 95,
    crit: 108
});
const fuelGauge = new ArcGauge('fuelGauge', {
    min: 0, max: 100, value: 100,
    color: '#a855f7',
    critLow: 10
});

/* ── DOM Element References ─────────────────────── */
const el = {
    rpm: document.getElementById('rpmValue'),
    rpmBar: document.getElementById('rpm-bar-fill'),
    speed: document.getElementById('speedValue'),
    gear: document.getElementById('gearDisplay'),
    boost: document.getElementById('boostValue'),
    oil: document.getElementById('oilValue'),
    temp: document.getElementById('tempValue'),
    fuel: document.getElementById('fuelValue'),
    throttle: document.getElementById('throttleValue'),
    throttleBar: document.getElementById('throttleBar'),
    load: document.getElementById('loadValue'),
    loadBar: document.getElementById('loadBar'),
    afr: document.getElementById('afrValue'),
    afrBar: document.getElementById('afrBar'),
    lapTime: document.getElementById('lap-time'),
};

const shiftLeds = Array.from({ length: 8 }, (_, i) => document.getElementById(`sl${i}`));

/* ── Shift Light Logic ─────────────────────────── */
// Thresholds: 0-4 green, 4-6 yellow, 6-7 red, 7+ flash all red
const LED_THRESHOLDS_GREEN = [0.60, 0.65, 0.70, 0.75];
const LED_THRESHOLDS_YELLOW = [0.80, 0.85];
const LED_THRESHOLDS_RED = [0.90, 0.95];
const SHIFT_POINT = 0.97; // 97% of max RPM = full-flash

function updateShiftLights(rpmPct) {
    const allThresholds = [
        ...LED_THRESHOLDS_GREEN.map(t => ({ t, col: 'green' })),
        ...LED_THRESHOLDS_YELLOW.map(t => ({ t, col: 'yellow' })),
        ...LED_THRESHOLDS_RED.map(t => ({ t, col: 'red' })),
    ];

    const isFlash = rpmPct >= SHIFT_POINT;

    shiftLeds.forEach((led, i) => {
        led.className = 'shift-led';
        if (isFlash) {
            led.classList.add('red', 'flash');
        } else if (rpmPct >= allThresholds[i].t) {
            led.classList.add(allThresholds[i].col);
        }
    });
}

/* ── RPM Bar Update ─────────────────────────────── */
function updateRpmBar(rpmPct) {
    el.rpmBar.style.width = (rpmPct * 100).toFixed(1) + '%';
    // Color glow shifts: green → yellow → red
    if (rpmPct > 0.88) {
        el.rpmBar.style.boxShadow = '0 0 8px rgba(255,34,68,0.7)';
    } else if (rpmPct > 0.72) {
        el.rpmBar.style.boxShadow = '0 0 8px rgba(240,192,0,0.6)';
    } else {
        el.rpmBar.style.boxShadow = '0 0 6px rgba(0,208,132,0.5)';
    }
}

/* ── Gear Calculation ────────────────────────────── */
function calcGear(speed, rpm) {
    if (speed < 3) return 'N';
    // Rough gear ratios
    const ratio = rpm / Math.max(speed, 1);
    if (ratio > 80) return '1';
    if (ratio > 54) return '2';
    if (ratio > 38) return '3';
    if (ratio > 28) return '4';
    if (ratio > 20) return '5';
    return '6';
}

/* ── Lap Timer ────────────────────────────────────── */
let lapStart = Date.now();
function updateLapTimer() {
    const elapsed = Date.now() - lapStart;
    const mins = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    const ms = (elapsed % 1000).toString().padStart(3, '0');
    el.lapTime.textContent = `LAP  ${mins}:${secs}.${ms}`;
}
setInterval(updateLapTimer, 10);

/* ── Main UI Update ─────────────────────────────── */
function updateUI(data) {
    const RPM_MAX = 8000;
    const rpmPct = Math.min(data.rpm / RPM_MAX, 1);

    // RPM
    el.rpm.textContent = Math.round(data.rpm).toString().padStart(4, '0');
    updateRpmBar(rpmPct);
    updateShiftLights(rpmPct);

    // Gear - use manual gear, fall back to neutral display
    const gearLabel = manualGear === 0 ? 'N' : String(manualGear);
    el.gear.textContent = gearLabel;
    el.gear.className = 'gear-display';
    if (rpmPct >= SHIFT_POINT) el.gear.classList.add('gear-shift');
    else if (manualGear >= 4) el.gear.classList.add('gear-high');

    // Speed
    el.speed.textContent = Math.round(data.speed).toString().padStart(3, '0');

    // Boost
    boostGauge.setValue(data.boost);
    el.boost.textContent = data.boost.toFixed(1);

    // Oil
    oilGauge.setValue(data.oil);
    el.oil.textContent = Math.round(data.oil);

    // Temp
    tempGauge.setValue(data.temp);
    el.temp.textContent = Math.round(data.temp);
    const tempWrap = document.querySelector('.right-col .arc-gauge-wrap:first-child');
    tempWrap.classList.remove('alarm-red', 'alarm-yellow');
    if (data.temp >= 108) tempWrap.classList.add('alarm-red');
    else if (data.temp >= 95) tempWrap.classList.add('alarm-yellow');

    // Fuel
    fuelGauge.setValue(data.fuel);
    el.fuel.textContent = Math.round(data.fuel);

    // Throttle
    const thr = Math.round(data.throttle);
    el.throttle.innerHTML = `${thr}<span class="tile-unit">%</span>`;
    el.throttleBar.style.width = thr + '%';
    el.throttleBar.style.background = thr > 90
        ? 'linear-gradient(90deg, #f0c000, #ff2244)'
        : 'linear-gradient(90deg, #00d084, #f0c000)';

    // Load
    const ld = Math.round(data.load);
    el.load.innerHTML = `${ld}<span class="tile-unit">%</span>`;
    el.loadBar.style.width = ld + '%';

    // Lambda (AFR)
    const afr = data.afr.toFixed(2);
    el.afr.innerHTML = `${afr}<span class="tile-unit">λ</span>`;
    // Lambda bar: 0.8 = rich end, 1.2 = lean end, center = stoich
    const afrPct = Math.min(Math.max((data.afr - 0.8) / 0.4, 0), 1) * 100;
    el.afrBar.style.width = afrPct + '%';
    // Color: rich=blue, stoich=green, lean=red
    if (data.afr < 0.95) el.afrBar.style.background = 'linear-gradient(90deg, #0096ff, #0096ff)';
    else if (data.afr > 1.05) el.afrBar.style.background = 'linear-gradient(90deg, #f0c000, #ff2244)';
    else el.afrBar.style.background = 'linear-gradient(90deg, #00d084, #00d084)';
}

/* ════════════════════════════════════════════════
   W-KEY THROTTLE PHYSICS ENGINE
   Hold W = throttle open, release = lift off
   ════════════════════════════════════════════════ */

/* ── State ──────────────────────────────────────── */
let wHeld = false;
let rpm = 900;
let boost = -12;
let temp = 75;
let oil = 65;
let speed = 0;
let throttle = 0;
let load = 15;
let fuel = 100;
let afr = 1.0;
let gearLock = false;   // brief freeze during shift animation
let gearLockTimer = 0;

// Manual gear: 0 = Neutral, 1-6 = gears
let manualGear = 0;

// Gear ratio table: maps gear → approximate RPM per km/h
// Used to set RPM when shifting into a gear at current speed
const GEAR_RATIOS = [0, 95, 62, 42, 30, 22, 16]; // index 0 unused (neutral)

/* ── Keyboard listeners ─────────────────────────── */
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW' && !e.repeat) {
        wHeld = true;
        updateKeyIndicator('w', true);
    }

    // E = upshift
    if (e.code === 'KeyE' && !e.repeat) {
        shiftGear(+1);
    }
    // Q = downshift
    if (e.code === 'KeyQ' && !e.repeat) {
        shiftGear(-1);
    }

    // B = brake blip
    if (e.code === 'KeyB' && !e.repeat) {
        rpm = Math.max(900, rpm - 1400);
        boost = -13;
        speed = Math.max(0, speed - 10);
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') {
        wHeld = false;
        updateKeyIndicator('w', false);
    }
});

/* ── Gear shift logic ───────────────────────────── */
function shiftGear(dir) {
    const prev = manualGear;
    manualGear = Math.max(0, Math.min(6, manualGear + dir));
    if (manualGear === prev) return;  // already at limit

    // Freeze physics briefly for shift feel
    gearLock = true;
    gearLockTimer = 6;  // ~300ms at 20Hz

    if (dir > 0) {
        // Upshift: RPM drops proportionally (like clutch engaging higher gear)
        const ratio = manualGear >= 1 ? GEAR_RATIOS[manualGear] / GEAR_RATIOS[prev || 1] : 1;
        rpm = Math.max(1800, rpm * ratio);
        boost = Math.max(-8, boost - 6);  // momentary blowoff
    } else {
        // Downshift: RPM blips up (heel-toe)
        const ratio = prev >= 1 && manualGear >= 1 ? GEAR_RATIOS[manualGear] / GEAR_RATIOS[prev] : 1;
        rpm = Math.min(7600, rpm * ratio);
        boost = Math.min(boost + 3, 5);
    }

    // Flash the badge
    const badge = dir > 0 ? 'e' : 'q';
    updateKeyIndicator(badge, true);
    setTimeout(() => updateKeyIndicator(badge, false), 200);
}

/* ── Key indicator UI ───────────────────────────── */
function buildKeyIndicator() {
    const div = document.createElement('div');
    div.id = 'key-hint';
    div.innerHTML = `
        <div class="key-badge key-shift" id="q-key"><span>Q</span></div>
        <span class="key-hint-label">DN</span>
        <div class="key-badge" id="w-key"><span>W</span></div>
        <span class="key-hint-label">THROTTLE</span>
        <div class="key-badge key-shift" id="e-key"><span>E</span></div>
        <span class="key-hint-label">UP</span>
        <div class="key-sep"></div>
        <div class="key-badge key-dim" id="b-key"><span>B</span></div>
        <span class="key-hint-label">BRAKE</span>
    `;
    document.getElementById('app').appendChild(div);
}
buildKeyIndicator();

/* key id map: 'w' → w-key, 'e' → e-key, 'q' → q-key, 'b' → b-key */
function updateKeyIndicator(key, active) {
    const k = document.getElementById(`${key}-key`);
    if (k) k.classList.toggle('active', active);
}

/* ── Inject key hint CSS ────────────────────────── */
const keyStyle = document.createElement('style');
keyStyle.textContent = `
#key-hint {
    position: absolute;
    bottom: 50px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 5px;
    z-index: 10;
    pointer-events: none;
    background: rgba(8,10,13,0.75);
    border: 1px solid #1e2736;
    border-radius: 6px;
    padding: 5px 8px;
    backdrop-filter: blur(6px);
}
.key-badge {
    width: 26px; height: 26px;
    border-radius: 4px;
    border: 1px solid #2a3548;
    background: #0d1117;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Orbitron', monospace;
    font-size: 0.6rem;
    font-weight: 700;
    color: #4a5568;
    transition: background 0.08s, box-shadow 0.08s, color 0.08s;
}
.key-badge#w-key.active {
    background: #00d084;
    border-color: #00d084;
    color: #000;
    box-shadow: 0 0 12px rgba(0,208,132,0.8);
}
.key-badge.key-shift.active {
    background: #0096ff;
    border-color: #0096ff;
    color: #fff;
    box-shadow: 0 0 12px rgba(0,150,255,0.8);
}
.key-badge.key-dim { opacity: 0.45; }
.key-sep {
    width: 1px; height: 20px;
    background: #1e2736;
    margin: 0 2px;
}
.key-hint-label {
    font-family: 'Inter', sans-serif;
    font-size: 0.42rem;
    font-weight: 600;
    color: #2d3748;
    letter-spacing: 1.5px;
    text-transform: uppercase;
}
`;
document.head.appendChild(keyStyle);

/* -- Physics loop - 20 Hz (matches Haltech/MoTeC) - */
setInterval(() => {
    const noise = () => (Math.random() - 0.5);

    if (wHeld) {
        /* ── ON THROTTLE ───────────────────────────── */
        throttle = Math.min(100, throttle + 12);
        load = Math.min(100, load + 8);

        if (!gearLock) {
            // RPM ceiling depends on current gear (higher gear = lower rev ceiling feel)
            const rpmCeil = manualGear === 0 ? 1800 : 7700;
            rpm = Math.min(rpmCeil, rpm + 260);
            boost = Math.min(22, boost + 2.5);
            // Speed only builds if in a real gear
            if (manualGear > 0) speed = Math.min(260, speed + 0.75);
        }

        temp = Math.min(105, temp + 0.06);
        oil = 65 + Math.sin(Date.now() / 5000) * 6;
        afr = 0.86 + noise() * 0.03;  // rich on boost
        fuel -= 0.045;

    } else {
        /* ── OFF THROTTLE / LIFT ───────────────────── */
        throttle = Math.max(0, throttle - 20);
        load = Math.max(10, load - 14);
        rpm = Math.max(900, rpm - 240);
        boost = Math.max(-13, boost - 4);
        speed = Math.max(0, speed - 0.5);  // gentle engine brake
        temp = Math.max(75, temp - 0.04);
        afr = 1.12 + noise() * 0.04;        // lean on decel
        fuel -= 0.003;
    }

    /* Gear lock countdown */
    if (gearLock) {
        gearLockTimer--;
        if (gearLockTimer <= 0) gearLock = false;
    }

    fuel = Math.max(0, fuel);

    updateUI({
        rpm: rpm + noise() * 25,
        boost: boost + noise() * 0.25,
        temp,
        oil: oil + noise() * 1.5,
        speed,
        throttle,
        load,
        fuel,
        afr: afr + noise() * 0.01,
    });

}, 50); // 20 Hz

/* ════════════════════════════════════════════════
   OBD-II Web Serial (ELM327 / USB adapter)
   ════════════════════════════════════════════════ */
document.getElementById('connect-btn').addEventListener('click', async () => {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported. Use Chrome/Edge on desktop.');
        return;
    }
    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 38400 });

        document.getElementById('conn-status').textContent = 'USB CONNECTED';
        document.getElementById('conn-dot').style.background = '#0096ff';
        document.getElementById('conn-dot').style.boxShadow = '0 0 8px #0096ff';

        clearInterval(simInterval);

        // Read stream (AT commands → PID parsing would live here)
        const textDecoder = new TextDecoderStream();
        port.readable.pipeTo(textDecoder.writable);
        // TODO: Send ATZ, ATE0, then poll PIDs (010C=RPM, 010D=Speed, etc.)

    } catch (err) {
        console.error('OBD connect error:', err);
        alert('Could not connect to OBD-II adapter.\nMake sure it is plugged in and try again.');
    }
});
