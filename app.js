const STAR_COUNT = 36;
const stars = [];
for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
        x: Math.floor(Math.random() * 214),
        y: Math.floor(Math.random() * 270)
    });
}

const BUBBLE_COUNT = 18;
const bubbles = [];
for (let i = 0; i < BUBBLE_COUNT; i++) {
    bubbles.push({
        x: 24 + Math.floor(Math.random() * 168),
        y: 135 + Math.floor(Math.random() * 120),
        speed: 0.3 + Math.random() * 0.6
    });
}

const PIXELS_PER_METER = 20;
const RIG_CENTER_X = 108;
const UNEXTENDED_Y = 125;
const MIN_X_METERS = -4.2;
const MAX_X_METERS = 5.8;
const SPHERE_RADIUS_M = 3.2;
const LJ_R0_METERS = 4.5;

const SoundEngine = {
    ctx: null,
    enabled: false,

    init: function() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },

    toggle: function() {
        this.init();
        this.enabled = !this.enabled;
        return this.enabled;
    },

    playEquilibriumTick: function(speed) {
        if (!this.enabled || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const pitch = Math.min(1400, 520 + speed * 45);
        osc.type = 'square';
        osc.frequency.setValueAtTime(pitch, now);

        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.02);
    },

    playStopImpact: function(impactSpeed) {
        if (!this.enabled || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.exponentialRampToValueAtTime(42, now + 0.065);

        const vol = Math.min(0.16, Math.max(0.03, impactSpeed * 0.015));
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.075);
    },

    playImpulseStrike: function() {
        if (!this.enabled || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.045);

        gain.gain.setValueAtTime(0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.055);
    }
};

const Physics = {
    mode: 'spring',
    isPaused: false,
    adiabaticActive: false,
    adiabaticTargetK: 12.5,

    params: {
        m: 2.0,
        k: 25.0,
        b: 1.5,
        F0: 0.0,
        w: 3.5,
        g: 0.0
    },

    state: {
        x: 2.0,
        v: 0.0,
        phi: 0.0,
        qLoss: 0.0,
        wDrive: 0.0,
        t: 0.0
    },

    resetEnergyLedger: function() {
        this.state.qLoss = 0.0;
        this.state.wDrive = 0.0;
    },

    getEquilibriumX: function() {
        const { m, k, g } = this.params;
        if (this.mode === 'buoyancy' || this.mode === 'lj') {
            return 0.0;
        }
        return (m * g) / k;
    },

    getRestoringForceAndPotential: function(x) {
        const { m, k, g } = this.params;
        const xEq = this.getEquilibriumX();
        const u = x - xEq;

        if (this.mode === 'buoyancy') {
            const R = SPHERE_RADIUS_M;
            const uc = Math.max(-R, Math.min(R, u));
            const fRestore = -k * uc * (1.0 - (uc * uc) / (3.0 * R * R));
            const vEff = 0.5 * k * (uc * uc) * (1.0 - (uc * uc) / (6.0 * R * R)) +
                (Math.abs(u) > R ? (2.0 / 3.0) * k * R * (Math.abs(u) - R) : 0.0);
            return { fTotal: fRestore, vEff: vEff };
        }

        if (this.mode === 'lj') {
            const r0 = LJ_R0_METERS;
            const epsilon = (k * r0 * r0) / 72.0;
            const xi = Math.max(0.72, 1.0 + u / r0);
            const invXi6 = Math.pow(xi, -6);
            const invXi12 = invXi6 * invXi6;
            const fLJ = (12.0 * epsilon / r0) * (invXi12 / xi - invXi6 / xi);
            const vEff = epsilon * (invXi12 - 2.0 * invXi6 + 1.0);
            return { fTotal: fLJ, vEff: Math.max(0.0, vEff) };
        }

        const fLinear = -k * x + m * g;
        const vEff = 0.5 * k * (u * u);
        return { fTotal: fLinear, vEff: vEff };
    },

    resetState: function(initialOffset = 2.0) {
        this.adiabaticActive = false;
        const xEq = this.getEquilibriumX();
        this.state.x = Math.max(MIN_X_METERS, Math.min(MAX_X_METERS, xEq + initialOffset));
        this.state.v = 0.0;
        this.state.phi = 0.0;
        this.state.t = 0.0;
        this.resetEnergyLedger();
    },

    getDerivatives: function(x, v, phi) {
        const { m, b, F0 } = this.params;
        const fDrive = F0 * Math.cos(phi);
        const { fTotal } = this.getRestoringForceAndPotential(x);
        const a = (fTotal - b * v + fDrive) / m;
        const dQ = b * (v * v);
        const dW = fDrive * v;
        return { dx: v, dv: a, dQ: dQ, dW: dW };
    },

    stepRK4: function(dt) {
        if (this.adiabaticActive) {
            const decayRate = 0.12;
            this.params.k += (this.adiabaticTargetK - this.params.k) * decayRate * dt;
            if (Math.abs(this.params.k - this.adiabaticTargetK) < 0.05) {
                this.params.k = this.adiabaticTargetK;
                this.adiabaticActive = false;
            }
            syncSlidersFromParams();
        }

        const { x, v, phi } = this.state;
        const { m, w } = this.params;
        const xEq = this.getEquilibriumX();
        const prevRelX = x - xEq;

        const k1 = this.getDerivatives(x, v, phi);
        const k2 = this.getDerivatives(
            x + 0.5 * dt * k1.dx,
            v + 0.5 * dt * k1.dv,
            phi + 0.5 * dt * w
        );
        const k3 = this.getDerivatives(
            x + 0.5 * dt * k2.dx,
            v + 0.5 * dt * k2.dv,
            phi + 0.5 * dt * w
        );
        const k4 = this.getDerivatives(
            x + dt * k3.dx,
            v + dt * k3.dv,
            phi + dt * w
        );

        this.state.x += (dt / 6.0) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
        this.state.v += (dt / 6.0) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);
        this.state.qLoss += (dt / 6.0) * (k1.dQ + 2 * k2.dQ + 2 * k3.dQ + k4.dQ);
        this.state.wDrive += (dt / 6.0) * (k1.dW + 2 * k2.dW + 2 * k3.dW + k4.dW);
        this.state.phi = (this.state.phi + w * dt) % (2 * Math.PI);
        this.state.t += dt;

        const currRelX = this.state.x - xEq;
        if (
            prevRelX * currRelX <= 0 &&
            Math.abs(prevRelX - currRelX) > 1e-4 &&
            Math.abs(this.state.v) > 0.15
        ) {
            SoundEngine.playEquilibriumTick(Math.abs(this.state.v));
        }

        if (this.state.x < MIN_X_METERS) {
            this.state.x = MIN_X_METERS;
            if (this.state.v < 0) {
                const vPre = this.state.v;
                const vPost = -0.25 * vPre;
                this.state.qLoss += 0.5 * m * (vPre * vPre - vPost * vPost);
                this.state.v = vPost;
                SoundEngine.playStopImpact(Math.abs(vPre));
            }
        } else if (this.state.x > MAX_X_METERS) {
            this.state.x = MAX_X_METERS;
            if (this.state.v > 0) {
                const vPre = this.state.v;
                const vPost = -0.25 * vPre;
                this.state.qLoss += 0.5 * m * (vPre * vPre - vPost * vPost);
                this.state.v = vPost;
                SoundEngine.playStopImpact(Math.abs(vPre));
            }
        }
    },

    getMetrics: function() {
        const { m, k, b, F0, w } = this.params;
        const { x, v, qLoss, wDrive } = this.state;

        const w0 = Math.sqrt(k / m);
        const gamma = b / (2.0 * m);
        const zeta = b / (2.0 * Math.sqrt(m * k));
        const xEq = this.getEquilibriumX();
        const wd = zeta < 1.0 ? Math.sqrt(w0 * w0 - gamma * gamma) : 0.0;
        const qNum = b > 1e-4 ? (m * w0) / b : Infinity;
        const qFactor = b > 1e-4 ? qNum.toFixed(2) : '&infin;';

        let regime = "Undamped";
        if (zeta > 0 && zeta < 0.995) regime = "Underdamped";
        else if (zeta >= 0.995 && zeta <= 1.005) regime = "Critically Damped";
        else if (zeta > 1.005) regime = "Overdamped";

        const isResonant = (F0 > 0) && (Math.abs(w - w0) / w0 < 0.05);

        const steadyDenom = Math.sqrt(Math.pow(k - m * w * w, 2) + Math.pow(b * w, 2));
        const steadyAmp = steadyDenom > 1e-6 ? F0 / steadyDenom : 0.0;
        const phiRad = Math.atan2(b * w, k - m * w * w);
        const phiDeg = (phiRad * 180.0) / Math.PI;

        const wAmp = (qNum * qNum > 0.5)
            ? w0 * Math.sqrt(1.0 - 1.0 / (2.0 * qNum * qNum))
            : 0.0;

        let odeHTML = "m<sub>eff</sub> x&#776; + b x&#775; + k(x &minus; x<sub>eq</sub>) = F<sub>0</sub> cos(&omega;t)";
        let odeSub = "Hooke's law restoring force with viscous damping force F = &minus;bv";
        let w0FormulaHTML = `&omega;<sub>0</sub> = &radic;<span class="sqrt"><span class="frac"><span>k</span><span>m + m<sub>s</sub>/3</span></span></span>`;

        if (this.mode === 'buoyancy') {
            odeHTML = "m x&#776; + b x&#775; + &rho;<sub>w</sub>g&pi;(R<sup>2</sup>x &minus; <sup>1</sup>&frasl;<sub>3</sub>x<sup>3</sup>) = F<sub>0</sub> cos(&omega;t)";
            odeSub = "Archimedes buoyant force on a sphere of radius R (M4 Problem 2b)";
            w0FormulaHTML = `&omega;<sub>0</sub> = &radic;<span class="sqrt"><span class="frac"><span>3g</span><span>2R</span></span></span> = &radic;<span class="sqrt"><span class="frac"><span>&rho;<sub>w</sub>g&pi;R<sup>2</sup></span><span>m</span></span></span>`;
        } else if (this.mode === 'lj') {
            odeHTML = "m<sub>eff</sub> r&#776; + b r&#775; &minus; <span class='frac'><span>12&epsilon;</span><span>r<sub>0</sub></span></span>[(r<sub>0</sub>/r)<sup>13</sup> &minus; (r<sub>0</sub>/r)<sup>7</sup>] = F<sub>0</sub> cos(&omega;t)";
            odeSub = "Lennard-Jones potential U(r) = &epsilon;[(r₀/r)¹² &minus; 2(r₀/r)⁶] (M4 Example 1)";
            w0FormulaHTML = `&omega;<sub>0</sub> = &radic;<span class="sqrt"><span class="frac"><span>U&prime;&prime;(r<sub>0</sub>)</span><span>m<sub>eff</sub></span></span></span> = <span class="frac"><span>12</span><span>r<sub>0</sub></span></span>&radic;<span class="sqrt"><span class="frac"><span>&epsilon;</span><span>m</span></span></span>`;
        }

        let formulaHTML = "x(t) = A cos(&omega;<sub>0</sub>t &minus; &delta;) + x<sub>eq</sub>";
        let solSub = "Pure harmonic motion with constant phase-space ellipse area I";
        if (F0 > 0) {
            formulaHTML = "x(t) = |A<sub>0</sub>| cos(&omega;t &minus; &phi;) + Re(A<sub>+</sub>e<sup>i&omega;<sub>+</sub>t</sup> + A<sub>&minus;</sub>e<sup>i&omega;<sub>&minus;</sub>t</sup>)";
            solSub = "Transient normal modes &omega;± decay as e^(&minus;bt/2m), leaving steady state |A₀|";
        } else if (regime === "Underdamped") {
            formulaHTML = "x(t) = A e<sup>&minus;(b/2m)t</sup> cos(&omega;<sub>d</sub>t &minus; &delta;) + x<sub>eq</sub>";
            solSub = "Complex roots &omega;± = i(b/2m) &plusmn; &omega;_d produce an inward phase-space spiral";
        } else if (regime === "Critically Damped") {
            formulaHTML = "x(t) = (C<sub>1</sub> + C<sub>2</sub>t) e<sup>&minus;&omega;<sub>0</sub>t</sup> + x<sub>eq</sub>";
            solSub = "Degenerate root b = 2&radic;(mk) yields fastest non-oscillatory equilibrium return";
        } else if (regime === "Overdamped") {
            formulaHTML = "x(t) = C<sub>1</sub> e<sup>&minus;&gamma;<sub>+</sub>t</sup> + C<sub>2</sub> e<sup>&minus;&gamma;<sub>&minus;</sub>t</sup> + x<sub>eq</sub>";
            solSub = "Purely imaginary roots &omega;± (b > 2&radic;mk) decay monotonically along slow eigenvector";
        }

        const K = 0.5 * m * (v * v);
        const { vEff } = this.getRestoringForceAndPotential(x);
        const Emech = K + vEff;
        const Eclosed = K + vEff + qLoss;
        const adiabaticI = (2.0 * Math.PI * Emech) / w0;

        return {
            w0, wd, zeta, qFactor, xEq, regime, isResonant,
            steadyAmp, phiDeg, wAmp, adiabaticI,
            odeHTML, odeSub, w0FormulaHTML, formulaHTML, solSub,
            K, Veff: vEff, qLoss, wDrive, Emech, Eclosed
        };
    }
};

const BUFFER_SIZE = 218;

const Diagnostics = {
    xHistory: new Float32Array(BUFFER_SIZE),
    vHistory: new Float32Array(BUFFER_SIZE),
    head: 0,
    count: 0,

    clear: function() {
        this.head = 0;
        this.count = 0;
    },

    record: function(x, v) {
        this.xHistory[this.head] = x;
        this.vHistory[this.head] = v;
        this.head = (this.head + 1) % BUFFER_SIZE;
        if (this.count < BUFFER_SIZE) this.count++;
    },

    getSample: function(i) {
        const start = this.count === BUFFER_SIZE ? this.head : 0;
        const idx = (start + i) % BUFFER_SIZE;
        return {
            x: this.xHistory[idx],
            v: this.vHistory[idx]
        };
    }
};

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const UI = {
    modeSubtitle: document.getElementById('mode-subtitle'),
    hudStatusBadge: document.getElementById('hud-status-badge'),
    hudScopeEq: document.getElementById('hud-scope-eq'),
    lblM: document.getElementById('lbl-m'),
    lblK: document.getElementById('lbl-k'),
    lblB: document.getElementById('lbl-b'),
    ode: document.getElementById('ode-readout'),
    odeSub: document.getElementById('ode-subnote'),
    w0Formula: document.getElementById('w0-formula-cell'),
    formula: document.getElementById('formula-readout'),
    solSub: document.getElementById('solution-subnote'),
    wd: document.getElementById('wd-readout'),
    phi: document.getElementById('phi-readout'),
    amp: document.getElementById('amp-readout'),
    wAmp: document.getElementById('wamp-readout'),
    wPow: document.getElementById('wpow-readout'),
    adiabatic: document.getElementById('adiabatic-readout'),
    qFactor: document.getElementById('qfactor-readout'),
    regime: document.getElementById('regime-readout'),
    w0: document.getElementById('w0-readout'),
    zeta: document.getElementById('zeta-readout'),
    xEq: document.getElementById('xeq-readout'),
    energy: document.getElementById('energy-readout'),
    time: document.getElementById('time-readout'),
    eKin: document.getElementById('e-kin-readout'),
    eVeff: document.getElementById('e-veff-readout'),
    eQloss: document.getElementById('e-qloss-readout'),
    eWdrive: document.getElementById('e-wdrive-readout'),
    btnPause: document.getElementById('btn-pause'),
    btnAudio: document.getElementById('btn-audio')
};

const sliderConfigs = [
    { id: 'slider-m', key: 'm', valId: 'val-m', unit: 'kg', dec: 2, resetE: true },
    { id: 'slider-k', key: 'k', valId: 'val-k', unit: 'N/m', dec: 1, resetE: true },
    { id: 'slider-b', key: 'b', valId: 'val-b', unit: 'N·s/m', dec: 2, resetE: false },
    { id: 'slider-f0', key: 'F0', valId: 'val-f0', unit: 'N', dec: 1, resetE: false },
    { id: 'slider-w', key: 'w', valId: 'val-w', unit: 'rad/s', dec: 2, resetE: false },
    { id: 'slider-g', key: 'g', valId: 'val-g', unit: 'm/s²', dec: 1, resetE: true }
];

function syncSlidersFromParams() {
    for (const cfg of sliderConfigs) {
        const slider = document.getElementById(cfg.id);
        const valSpan = document.getElementById(cfg.valId);
        const val = Physics.params[cfg.key];
        slider.value = val;
        valSpan.innerText = `${val.toFixed(cfg.dec)} ${cfg.unit}`;
    }
}

for (const cfg of sliderConfigs) {
    const slider = document.getElementById(cfg.id);
    const valSpan = document.getElementById(cfg.valId);
    slider.addEventListener('input', (e) => {
        Physics.adiabaticActive = false;
        const val = parseFloat(e.target.value);
        Physics.params[cfg.key] = val;
        valSpan.innerText = `${val.toFixed(cfg.dec)} ${cfg.unit}`;
        if (cfg.resetE) {
            Physics.resetEnergyLedger();
        }
    });
}

function switchApparatus(mode) {
    Physics.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'spring') {
        UI.modeSubtitle.innerText = 'Damped & Driven Harmonic Oscillator';
        UI.lblM.innerText = 'Effective Mass';
        UI.lblK.innerText = 'Spring Constant';
        UI.lblB.innerText = 'Damping Coefficient';
        Physics.params.g = 0.0;
        Physics.resetState(2.2);
    } else if (mode === 'buoyancy') {
        UI.modeSubtitle.innerText = 'Hydrostatic Floating Sphere (M4 Prob. 2b)';
        UI.lblM.innerText = 'Sphere + Added Mass';
        UI.lblK.innerText = 'Waterline Stiffness';
        UI.lblB.innerText = 'Viscous Wave Drag';
        if (Physics.params.g < 1.0) Physics.params.g = 9.8;
        Physics.resetState(2.2);
    } else if (mode === 'lj') {
        UI.modeSubtitle.innerText = 'Lennard-Jones Atomic Potential (M4 Ex. 1)';
        UI.lblM.innerText = 'Reduced Mass';
        UI.lblK.innerText = 'Curvature U″(r₀)';
        UI.lblB.innerText = 'Radiative Damping';
        Physics.params.g = 0.0;
        Physics.resetState(1.8);
    }

    syncSlidersFromParams();
    Diagnostics.clear();
}

document.getElementById('mode-spring').addEventListener('click', () => switchApparatus('spring'));
document.getElementById('mode-buoyancy').addEventListener('click', () => switchApparatus('buoyancy'));
document.getElementById('mode-lj').addEventListener('click', () => switchApparatus('lj'));

function applyPreset(presetName) {
    Physics.isPaused = false;
    Physics.adiabaticActive = false;
    UI.btnPause.innerText = 'Pause';
    UI.hudStatusBadge.classList.add('hidden');

    if (presetName === 'undamped') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.b = 0.0;
        Physics.params.F0 = 0.0;
        Physics.resetState(2.4);
    } else if (presetName === 'underdamped') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.b = 1.5;
        Physics.params.F0 = 0.0;
        Physics.resetState(2.6);
    } else if (presetName === 'critical') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.b = 2.0 * Math.sqrt(Physics.params.m * Physics.params.k);
        Physics.params.F0 = 0.0;
        Physics.resetState(3.2);
    } else if (presetName === 'overdamped') {
        Physics.params.m = 3.0;
        Physics.params.k = 20.0;
        Physics.params.b = 26.0;
        Physics.params.F0 = 0.0;
        Physics.resetState(3.2);
    } else if (presetName === 'resonance') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.b = 0.45;
        Physics.params.F0 = 8.0;
        Physics.params.w = Math.sqrt(Physics.params.k / Physics.params.m);
        Physics.resetState(0.0);
    }

    syncSlidersFromParams();
    Diagnostics.clear();
}

function triggerAdiabaticWeakening() {
    Physics.isPaused = false;
    Physics.params.b = 0.0;
    Physics.params.F0 = 0.0;
    if (Math.abs(Physics.state.x - Physics.getEquilibriumX()) < 0.3 && Math.abs(Physics.state.v) < 0.3) {
        Physics.resetState(2.2);
    }
    Physics.adiabaticTargetK = Math.max(5.0, Physics.params.k * 0.5);
    Physics.adiabaticActive = true;
    syncSlidersFromParams();
}

function triggerImpulse() {
    Physics.state.v += 6.0;
    Physics.resetEnergyLedger();
    SoundEngine.playImpulseStrike();
}

function togglePause() {
    Physics.isPaused = !Physics.isPaused;
    UI.btnPause.innerText = Physics.isPaused ? 'Resume' : 'Pause';
    UI.hudStatusBadge.innerText = 'Paused';
    UI.hudStatusBadge.classList.toggle('hidden', !Physics.isPaused);
}

function resetSimulation() {
    Physics.resetState(2.0);
    Diagnostics.clear();
}

function toggleAudio() {
    const active = SoundEngine.toggle();
    UI.btnAudio.innerText = active ? 'Audio: On' : 'Audio: Off';
    UI.btnAudio.classList.toggle('active', active);
}

document.getElementById('btn-undamped').addEventListener('click', () => applyPreset('undamped'));
document.getElementById('btn-underdamped').addEventListener('click', () => applyPreset('underdamped'));
document.getElementById('btn-critical').addEventListener('click', () => applyPreset('critical'));
document.getElementById('btn-overdamped').addEventListener('click', () => applyPreset('overdamped'));
document.getElementById('btn-resonance').addEventListener('click', () => applyPreset('resonance'));
document.getElementById('btn-adiabatic').addEventListener('click', triggerAdiabaticWeakening);
document.getElementById('btn-impulse').addEventListener('click', triggerImpulse);
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-reset').addEventListener('click', resetSimulation);
document.getElementById('btn-audio').addEventListener('click', toggleAudio);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
    } else if (e.code === 'KeyR') {
        resetSimulation();
    } else if (e.code === 'KeyI') {
        triggerImpulse();
    } else if (e.code === 'KeyA') {
        triggerAdiabaticWeakening();
    } else if (e.code === 'KeyM') {
        toggleAudio();
    } else if (e.code === 'Digit1') {
        applyPreset('undamped');
    } else if (e.code === 'Digit2') {
        applyPreset('underdamped');
    } else if (e.code === 'Digit3') {
        applyPreset('critical');
    } else if (e.code === 'Digit4') {
        applyPreset('overdamped');
    } else if (e.code === 'Digit5') {
        applyPreset('resonance');
    }
});

const Interaction = {
    isDragging: false,
    isHovering: false,
    dragHistory: [],
    HISTORY_WINDOW_MS: 50
};

function getCanvasMousePos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function getPayloadBounds() {
    const payloadY = Math.round(UNEXTENDED_Y + Physics.state.x * PIXELS_PER_METER);
    const size = Math.round(22 + Physics.params.m * 1.8);
    return {
        x: RIG_CENTER_X - Math.floor(size / 2),
        y: payloadY - Math.floor(size / 2),
        centerY: payloadY,
        radius: Math.floor(size / 2),
        size: size
    };
}

canvas.addEventListener('mousedown', (e) => {
    const pos = getCanvasMousePos(e);
    const bounds = getPayloadBounds();

    if (
        pos.x >= bounds.x - 32 &&
        pos.x <= bounds.x + bounds.size + 32 &&
        pos.y >= bounds.y - 8 &&
        pos.y <= bounds.y + bounds.size + 8
    ) {
        Interaction.isDragging = true;
        Interaction.dragHistory = [{ y: Physics.state.x, t: performance.now() }];
        Physics.state.v = 0;
        Physics.resetEnergyLedger();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const pos = getCanvasMousePos(e);
    const bounds = getPayloadBounds();

    Interaction.isHovering = (
        pos.x >= bounds.x - 32 &&
        pos.x <= bounds.x + bounds.size + 32 &&
        pos.y >= bounds.y - 8 &&
        pos.y <= bounds.y + bounds.size + 8
    );
    canvas.style.cursor = Interaction.isDragging
        ? 'grabbing'
        : (Interaction.isHovering ? 'grab' : 'default');

    if (!Interaction.isDragging) return;

    const rawX = (pos.y - UNEXTENDED_Y) / PIXELS_PER_METER;
    const clampedX = Math.max(MIN_X_METERS, Math.min(MAX_X_METERS, rawX));
    Physics.state.x = clampedX;
    Physics.resetEnergyLedger();

    const now = performance.now();
    Interaction.dragHistory.push({ y: clampedX, t: now });
    Interaction.dragHistory = Interaction.dragHistory.filter(
        record => (now - record.t) <= Interaction.HISTORY_WINDOW_MS
    );
});

function releasePayload() {
    if (!Interaction.isDragging) return;
    Interaction.isDragging = false;
    canvas.style.cursor = Interaction.isHovering ? 'grab' : 'default';

    const now = performance.now();
    const valid = Interaction.dragHistory.filter(
        r => (now - r.t) <= Interaction.HISTORY_WINDOW_MS
    );

    if (valid.length > 1) {
        const oldest = valid[0];
        const newest = valid[valid.length - 1];
        const dtSeconds = (newest.t - oldest.t) / 1000;
        Physics.state.v = dtSeconds > 0 ? (newest.y - oldest.y) / dtSeconds : 0;
    } else {
        Physics.state.v = 0;
    }
    Physics.resetEnergyLedger();
    Interaction.dragHistory = [];
}

canvas.addEventListener('mouseup', releasePayload);
canvas.addEventListener('mouseleave', releasePayload);

function drawPixelLine(x0, y0, x1, y1, color, thickness = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    ctx.fillStyle = color;
    while (true) {
        ctx.fillRect(x0, y0, thickness, thickness);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
}

function drawPixelCircle(cx, cy, r, fillColor, strokeColor, highlightColor) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    r = Math.round(r);

    for (let dy = -r; dy <= r; dy++) {
        const dxLimit = Math.floor(Math.sqrt(r * r - dy * dy));
        ctx.fillStyle = fillColor;
        ctx.fillRect(cx - dxLimit, cy + dy, dxLimit * 2 + 1, 1);

        if (strokeColor) {
            ctx.fillStyle = strokeColor;
            ctx.fillRect(cx - dxLimit, cy + dy, 2, 1);
            ctx.fillRect(cx + dxLimit - 1, cy + dy, 2, 1);
        }
    }

    if (highlightColor && r >= 8) {
        ctx.fillStyle = highlightColor;
        ctx.fillRect(cx - Math.floor(r * 0.45), cy - Math.floor(r * 0.45), 3, 3);
        ctx.fillRect(cx - Math.floor(r * 0.25), cy - Math.floor(r * 0.55), 2, 2);
    }
}

function drawPixelBezel(x, y, w, h, borderColor) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = borderColor;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
}

function drawBaseStage() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#555555';
    ctx.fillRect(215, 0, 2, canvas.height);
}

function drawEquilibriumMarkers(xEq) {
    ctx.fillStyle = '#444444';
    for (let x = 14; x < 202; x += 8) {
        ctx.fillRect(x, UNEXTENDED_Y, 4, 1);
    }

    const eqY = Math.round(UNEXTENDED_Y + xEq * PIXELS_PER_METER);
    const clampedEqY = Math.max(25, Math.min(265, eqY));
    ctx.fillStyle = '#00FF66';
    for (let x = 14; x < 202; x += 6) {
        ctx.fillRect(x, clampedEqY, 3, 1);
    }
}

function drawSpringApparatus(xEq) {
    for (let i = 0; i < STAR_COUNT; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#555555' : '#FFFFFF';
        ctx.fillRect(stars[i].x, stars[i].y, 1, 1);
    }

    drawEquilibriumMarkers(xEq);

    ctx.fillStyle = '#555555';
    ctx.fillRect(RIG_CENTER_X - 55, 0, 110, 18);
    ctx.fillStyle = '#000000';
    for (let x = RIG_CENTER_X - 49; x < RIG_CENTER_X + 49; x += 10) {
        ctx.fillRect(x, 2, 6, 14);
    }

    const driveOffset = Physics.params.F0 > 0
        ? Math.round((Physics.params.F0 / 30) * 8 * Math.cos(Physics.state.phi))
        : 0;
    const anchorY = 22 + driveOffset;

    ctx.fillStyle = Physics.params.F0 > 0 ? '#FF0044' : '#FFB000';
    ctx.fillRect(RIG_CENTER_X - 10, anchorY - 4, 20, 6);

    const bounds = getPayloadBounds();
    const length = bounds.y - (anchorY + 2);

    if (length > 2) {
        if (Physics.params.b > 0) {
            const sleeveHeight = Math.max(8, Math.floor(length * 0.45));
            const sleeveWidth = Math.round(6 + (Physics.params.b / 30) * 12);
            ctx.fillStyle = '#222222';
            ctx.fillRect(
                RIG_CENTER_X - Math.floor(sleeveWidth / 2),
                anchorY + 2,
                sleeveWidth,
                sleeveHeight
            );
            ctx.fillStyle = '#555555';
            ctx.fillRect(
                RIG_CENTER_X - Math.floor(sleeveWidth / 2),
                anchorY + sleeveHeight,
                sleeveWidth,
                2
            );
        }

        const coils = Math.round(8 + (Physics.params.k / 100) * 12);
        const segment = length / coils;
        const wireThickness = Physics.params.k >= 60 ? 2 : 1;

        let prevX = RIG_CENTER_X;
        let prevY = anchorY + 2;

        for (let i = 1; i < coils; i++) {
            const nextX = RIG_CENTER_X + ((i % 2 === 0) ? -9 : 9);
            const nextY = Math.round(anchorY + 2 + i * segment);
            drawPixelLine(prevX, prevY, nextX, nextY, '#FFB000', wireThickness);
            prevX = nextX;
            prevY = nextY;
        }
        drawPixelLine(prevX, prevY, RIG_CENTER_X, bounds.y, '#FFB000', wireThickness);
    }

    const { x, y, size } = bounds;
    const wingY = y + Math.floor(size / 2) - 5;
    ctx.fillStyle = '#FFB000';
    ctx.fillRect(x - 28, wingY, 26, 10);
    ctx.fillRect(x + size + 2, wingY, 26, 10);

    ctx.fillStyle = '#000000';
    for (let offset = 6; offset < 26; offset += 6) {
        ctx.fillRect(x - 28 + offset, wingY, 1, 10);
        ctx.fillRect(x + size + 2 + offset, wingY, 1, 10);
    }

    ctx.fillStyle = (Interaction.isDragging || Interaction.isHovering) ? '#FFFFFF' : '#00FFFF';
    ctx.fillRect(x, y, size, size);

    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
    ctx.fillStyle = '#00FFFF';
    ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
}

function drawBuoyancyApparatus(xEq) {
    const tankLeft = 16;
    const tankRight = 200;
    const tankTop = 22;
    const tankBottom = 258;
    const waterY = UNEXTENDED_Y;

    ctx.fillStyle = '#081826';
    ctx.fillRect(tankLeft, waterY, tankRight - tankLeft, tankBottom - waterY);

    ctx.fillStyle = '#0e2a42';
    for (let y = waterY + 6; y < tankBottom; y += 10) {
        for (let x = tankLeft + 4 + (y % 4); x < tankRight - 4; x += 12) {
            ctx.fillRect(x, y, 4, 1);
        }
    }

    ctx.fillStyle = '#00FFFF';
    for (let i = 0; i < BUBBLE_COUNT; i++) {
        const b = bubbles[i];
        if (!Physics.isPaused) {
            b.y -= b.speed + Math.abs(Physics.state.v) * 0.08;
            if (b.y <= waterY + 4) {
                b.y = tankBottom - 6;
                b.x = tankLeft + 10 + Math.floor(Math.random() * (tankRight - tankLeft - 20));
            }
        }
        ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 2);
    }

    const bounds = getPayloadBounds();
    const isActiveSelect = Interaction.isDragging || Interaction.isHovering;
    drawPixelCircle(
        RIG_CENTER_X,
        bounds.centerY,
        bounds.radius,
        isActiveSelect ? '#FFFFFF' : '#FFB000',
        '#00FFFF',
        '#FFFFFF'
    );

    ctx.fillStyle = '#FF0044';
    ctx.fillRect(
        RIG_CENTER_X - bounds.radius + 2,
        bounds.centerY - 1,
        bounds.radius * 2 - 4,
        2
    );

    const waveAmp = Physics.params.F0 > 0 ? (Physics.params.F0 / 30) * 5.0 : 1.0;
    const splashAmp = Math.min(4.0, Math.abs(Physics.state.v) * 0.35);
    let prevWX = tankLeft;
    let prevWY = waterY;

    for (let x = tankLeft; x <= tankRight; x += 4) {
        const distFromCenter = Math.abs(x - RIG_CENTER_X);
        const localRipple = Math.exp(-distFromCenter * 0.03) * splashAmp * Math.sin(distFromCenter * 0.25 - Physics.state.t * 8.0);
        const driveWave = waveAmp * Math.sin((x - tankLeft) * 0.09 - Physics.state.phi);
        const wy = Math.round(waterY + driveWave + localRipple);
        drawPixelLine(prevWX, prevWY, x, wy, '#00FFFF', 2);
        prevWX = x;
        prevWY = wy;
    }

    drawEquilibriumMarkers(xEq);

    ctx.fillStyle = '#555555';
    ctx.fillRect(tankLeft - 3, tankTop, 3, tankBottom - tankTop + 3);
    ctx.fillRect(tankRight, tankTop, 3, tankBottom - tankTop + 3);
    ctx.fillRect(tankLeft - 3, tankBottom, tankRight - tankLeft + 6, 3);

    for (let y = tankTop + 10; y < tankBottom; y += 20) {
        ctx.fillRect(tankLeft, y, 4, 1);
        ctx.fillRect(tankRight - 4, y, 4, 1);
    }
}

function drawLennardJonesApparatus(xEq) {
    const fixedAtomY = 32;
    const bounds = getPayloadBounds();

    let prevWellX = null;
    let prevWellY = null;
    for (let py = 58; py <= 250; py += 3) {
        const u = (py - UNEXTENDED_Y) / PIXELS_PER_METER;
        const xi = Math.max(0.75, 1.0 + u / LJ_R0_METERS);
        const vNorm = Math.pow(xi, -12) - 2.0 * Math.pow(xi, -6) + 1.0;
        const wx = Math.round(36 + Math.min(140, vNorm * 45));
        if (prevWellX !== null) {
            drawPixelLine(prevWellX, prevWellY, wx, py, '#222228', 1);
        }
        prevWellX = wx;
        prevWellY = py;
    }

    drawEquilibriumMarkers(xEq);

    const distPx = bounds.centerY - fixedAtomY;
    const steps = 16;
    for (let i = 1; i < steps; i++) {
        const by = Math.round(fixedAtomY + (distPx * i) / steps);
        const spread = Math.round(6 * Math.sin((i / steps) * Math.PI * 4));
        ctx.fillStyle = Physics.state.x < -0.2 ? '#FF0044' : '#00FF66';
        ctx.fillRect(RIG_CENTER_X + spread - 1, by, 2, 2);
        ctx.fillRect(RIG_CENTER_X - spread - 1, by, 2, 2);
    }

    drawPixelCircle(RIG_CENTER_X, fixedAtomY, 12, '#555555', '#FFB000', '#FFFFFF');

    const isActiveSelect = Interaction.isDragging || Interaction.isHovering;
    drawPixelCircle(
        RIG_CENTER_X,
        bounds.centerY,
        bounds.radius,
        isActiveSelect ? '#FFFFFF' : '#00FFFF',
        '#FFB000',
        '#FFFFFF'
    );
}

function drawEnergyBarometer(metrics) {
    const BAR_X = 224;
    const BAR_Y = 14;
    const BAR_W = 20;
    const BAR_H = 236;

    drawPixelBezel(BAR_X, BAR_Y, BAR_W, BAR_H, '#555555');

    const innerX = BAR_X + 2;
    const innerW = BAR_W - 4;
    const maxPixels = BAR_H - 4;
    const bottomY = BAR_Y + BAR_H - 2;

    ctx.fillStyle = '#222222';
    for (let frac = 0.25; frac < 1.0; frac += 0.25) {
        const tickY = Math.round(bottomY - frac * maxPixels);
        ctx.fillRect(BAR_X + 1, tickY, BAR_W - 2, 1);
    }

    const totalBudget = metrics.Eclosed;
    if (totalBudget > 1e-4) {
        const scaleRef = Physics.params.F0 > 0
            ? Math.max(totalBudget, 50.0)
            : totalBudget;

        const totalPixels = Math.min(
            maxPixels,
            Math.round((totalBudget / scaleRef) * maxPixels)
        );

        const hK = Math.round((metrics.K / totalBudget) * totalPixels);
        const hV = Math.round((metrics.Veff / totalBudget) * totalPixels);
        const hQ = Math.max(0, totalPixels - hK - hV);

        if (hK > 0) {
            ctx.fillStyle = '#00FFFF';
            ctx.fillRect(innerX, bottomY - hK, innerW, hK);
        }

        if (hV > 0) {
            ctx.fillStyle = '#00FF66';
            ctx.fillRect(innerX, bottomY - hK - hV, innerW, hV);
        }

        if (hQ > 0) {
            ctx.fillStyle = '#FF0044';
            ctx.fillRect(innerX, bottomY - hK - hV - hQ, innerW, hQ);
        }

        ctx.fillStyle = '#FFB000';
        ctx.fillRect(innerX - 1, bottomY - totalPixels - 1, innerW + 2, 1);
    }
}

function drawOscilloscope(xEq) {
    const BOX_X = 254;
    const BOX_Y = 14;
    const BOX_W = 218;
    const BOX_H = 104;
    const CENTER_Y = BOX_Y + Math.floor(BOX_H / 2);
    const SCALE_Y = 8.0;

    drawPixelBezel(BOX_X, BOX_Y, BOX_W, BOX_H, '#555555');

    ctx.fillStyle = '#222222';
    for (let gx = BOX_X + 20; gx < BOX_X + BOX_W; gx += 20) {
        ctx.fillRect(gx, BOX_Y + 1, 1, BOX_H - 2);
    }
    for (let gy = BOX_Y + 26; gy < BOX_Y + BOX_H; gy += 26) {
        ctx.fillRect(BOX_X + 1, gy, BOX_W - 2, 1);
    }

    ctx.fillStyle = '#555555';
    ctx.fillRect(BOX_X + 1, CENTER_Y, BOX_W - 2, 1);

    const eqPlotY = Math.max(
        BOX_Y + 2,
        Math.min(BOX_Y + BOX_H - 3, Math.round(CENTER_Y + xEq * SCALE_Y))
    );
    ctx.fillStyle = '#00FF66';
    for (let gx = BOX_X + 2; gx < BOX_X + BOX_W - 2; gx += 6) {
        ctx.fillRect(gx, eqPlotY, 3, 1);
    }

    const stageScaleY = 450.0 / 270.0;
    UI.hudScopeEq.style.top = `${Math.round(eqPlotY * stageScaleY - 8)}px`;

    const count = Diagnostics.count;
    if (count < 2) return;

    const xOffset = BOX_X + (BOX_W - count);
    let prevPlotX = xOffset;
    let prevPlotY = Math.max(
        BOX_Y + 1,
        Math.min(BOX_Y + BOX_H - 2, Math.round(CENTER_Y + Diagnostics.getSample(0).x * SCALE_Y))
    );

    for (let i = 1; i < count; i++) {
        const sample = Diagnostics.getSample(i);
        const curPlotX = xOffset + i;
        const curPlotY = Math.max(
            BOX_Y + 1,
            Math.min(BOX_Y + BOX_H - 2, Math.round(CENTER_Y + sample.x * SCALE_Y))
        );
        drawPixelLine(prevPlotX, prevPlotY, curPlotX, curPlotY, '#FFB000', 1);
        prevPlotX = curPlotX;
        prevPlotY = curPlotY;
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(prevPlotX - 1, prevPlotY - 1, 2, 2);
}

function drawPhasePortrait(xEq) {
    const BOX_X = 254;
    const BOX_Y = 132;
    const BOX_W = 218;
    const BOX_H = 128;
    const ORIGIN_X = BOX_X + Math.floor(BOX_W / 2);
    const ORIGIN_Y = BOX_Y + Math.floor(BOX_H / 2);

    const SCALE_X = 16.0;
    const SCALE_V = 2.2;

    drawPixelBezel(BOX_X, BOX_Y, BOX_W, BOX_H, '#555555');

    ctx.fillStyle = '#222222';
    for (let gx = BOX_X + 20; gx < BOX_X + BOX_W; gx += 20) {
        ctx.fillRect(gx, BOX_Y + 1, 1, BOX_H - 2);
    }
    for (let gy = BOX_Y + 21; gy < BOX_Y + BOX_H; gy += 21) {
        ctx.fillRect(BOX_X + 1, gy, BOX_W - 2, 1);
    }

    ctx.fillStyle = '#555555';
    ctx.fillRect(BOX_X + 1, ORIGIN_Y, BOX_W - 2, 1);
    ctx.fillRect(ORIGIN_X, BOX_Y + 1, 1, BOX_H - 2);

    const eqPlotX = Math.max(
        BOX_X + 3,
        Math.min(BOX_X + BOX_W - 4, Math.round(ORIGIN_X + xEq * SCALE_X))
    );
    ctx.fillStyle = '#00FF66';
    ctx.fillRect(eqPlotX - 3, ORIGIN_Y, 7, 1);
    ctx.fillRect(eqPlotX, ORIGIN_Y - 3, 1, 7);

    const count = Diagnostics.count;
    if (count < 2) return;

    function mapToPhaseBox(sample) {
        const px = Math.round(ORIGIN_X + sample.x * SCALE_X);
        const py = Math.round(ORIGIN_Y - sample.v * SCALE_V);
        return {
            x: Math.max(BOX_X + 1, Math.min(BOX_X + BOX_W - 2, px)),
            y: Math.max(BOX_Y + 1, Math.min(BOX_Y + BOX_H - 2, py))
        };
    }

    let prevPt = mapToPhaseBox(Diagnostics.getSample(0));

    for (let i = 1; i < count; i++) {
        const curPt = mapToPhaseBox(Diagnostics.getSample(i));
        const ageRatio = i / count;

        let segColor = '#222222';
        if (ageRatio > 0.75) segColor = '#00FFFF';
        else if (ageRatio > 0.35) segColor = '#555555';

        drawPixelLine(prevPt.x, prevPt.y, curPt.x, curPt.y, segColor, 1);
        prevPt = curPt;
    }

    ctx.fillStyle = '#FFB000';
    ctx.fillRect(prevPt.x - 1, prevPt.y - 1, 3, 3);
}

const TIME_STEP = 1 / 60;

function gameLoop() {
    if (!Interaction.isDragging && !Physics.isPaused) {
        Physics.stepRK4(TIME_STEP);
        Diagnostics.record(Physics.state.x, Physics.state.v);
    } else if (Interaction.isDragging) {
        Diagnostics.record(Physics.state.x, Physics.state.v);
    }

    const metrics = Physics.getMetrics();

    if (Physics.adiabaticActive) {
        UI.hudStatusBadge.innerText = 'Adiabatic k → k/2';
        UI.hudStatusBadge.classList.remove('hidden');
    } else if (!Physics.isPaused) {
        UI.hudStatusBadge.classList.add('hidden');
    }

    UI.ode.innerHTML = metrics.odeHTML;
    UI.odeSub.innerHTML = metrics.odeSub;
    UI.w0Formula.innerHTML = metrics.w0FormulaHTML;
    UI.formula.innerHTML = metrics.formulaHTML;
    UI.solSub.innerHTML = metrics.solSub;

    UI.w0.innerText = metrics.w0.toFixed(2);
    UI.zeta.innerText = metrics.zeta.toFixed(2);
    UI.wd.innerText = metrics.wd.toFixed(2);
    UI.qFactor.innerHTML = metrics.qFactor;
    UI.amp.innerText = metrics.steadyAmp.toFixed(2);
    UI.phi.innerHTML = `${metrics.phiDeg.toFixed(1)}&deg;`;
    UI.wAmp.innerText = metrics.wAmp.toFixed(2);
    UI.wPow.innerText = metrics.w0.toFixed(2);
    UI.adiabatic.innerText = metrics.adiabaticI.toFixed(2);

    UI.regime.innerText = metrics.isResonant
        ? `${metrics.regime} (Resonance)`
        : metrics.regime;
    UI.regime.className = metrics.isResonant ? 'regime-pill warning' : 'regime-pill';

    UI.xEq.innerText = metrics.xEq.toFixed(2);
    UI.energy.innerText = metrics.Emech.toFixed(2);
    UI.time.innerText = Physics.state.t.toFixed(2);

    UI.eKin.innerText = metrics.K.toFixed(2);
    UI.eVeff.innerText = metrics.Veff.toFixed(2);
    UI.eQloss.innerText = metrics.qLoss.toFixed(2);
    UI.eWdrive.innerText = metrics.wDrive.toFixed(2);

    drawBaseStage();
    if (Physics.mode === 'spring') {
        drawSpringApparatus(metrics.xEq);
    } else if (Physics.mode === 'buoyancy') {
        drawBuoyancyApparatus(metrics.xEq);
    } else if (Physics.mode === 'lj') {
        drawLennardJonesApparatus(metrics.xEq);
    }

    drawEnergyBarometer(metrics);
    drawOscilloscope(metrics.xEq);
    drawPhasePortrait(metrics.xEq);

    requestAnimationFrame(gameLoop);
}

syncSlidersFromParams();
gameLoop();