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
const MAGLEV_BETA = 0.025;

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
    mode: 'tether',
    isPaused: false,

    params: {
        m: 2.0,
        k: 25.0,
        c: 1.5,
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
        if (this.mode === 'buoyancy') {
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
            const uEff = 0.5 * k * (uc * uc) * (1.0 - (uc * uc) / (6.0 * R * R)) +
                (Math.abs(u) > R ? (2.0 / 3.0) * k * R * (Math.abs(u) - R) : 0.0);
            return { fTotal: fRestore, uEff: uEff, usRaw: uEff, ugRaw: -m * g * x };
        }

        if (this.mode === 'maglev') {
            const fSpring = -k * x * (1.0 + MAGLEV_BETA * x * x) + m * g;
            const uEff = 0.5 * k * (u * u) * (1.0 + 0.5 * MAGLEV_BETA * u * u);
            const usRaw = 0.5 * k * (x * x) * (1.0 + 0.5 * MAGLEV_BETA * x * x);
            return { fTotal: fSpring, uEff: uEff, usRaw: usRaw, ugRaw: -m * g * x };
        }

        const fLinear = -k * x + m * g;
        const uEff = 0.5 * k * (u * u);
        const usRaw = 0.5 * k * (x * x);
        return { fTotal: fLinear, uEff: uEff, usRaw: usRaw, ugRaw: -m * g * x };
    },

    resetState: function(initialOffset = 2.0) {
        const xEq = this.getEquilibriumX();
        this.state.x = Math.max(MIN_X_METERS, Math.min(MAX_X_METERS, xEq + initialOffset));
        this.state.v = 0.0;
        this.state.phi = 0.0;
        this.state.t = 0.0;
        this.resetEnergyLedger();
    },

    getDerivatives: function(x, v, phi) {
        const { m, c, F0 } = this.params;
        const fDrive = F0 * Math.cos(phi);
        const { fTotal } = this.getRestoringForceAndPotential(x);
        const a = (fTotal - c * v + fDrive) / m;
        const dQ = c * (v * v);
        const dW = fDrive * v;
        return { dx: v, dv: a, dQ: dQ, dW: dW };
    },

    stepRK4: function(dt) {
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
        const { m, k, c, F0, w } = this.params;
        const { x, v, qLoss, wDrive } = this.state;

        const w0 = Math.sqrt(k / m);
        const zeta = c / (2 * Math.sqrt(k * m));
        const xEq = this.getEquilibriumX();
        const wd = zeta < 1.0 ? w0 * Math.sqrt(1.0 - zeta * zeta) : 0.0;
        const qFactor = zeta > 1e-4 ? (1.0 / (2.0 * zeta)).toFixed(2) : '&infin;';

        let regime = "UNDAMPED";
        if (zeta > 0 && zeta < 0.995) regime = "UNDERDAMPED";
        else if (zeta >= 0.995 && zeta <= 1.005) regime = "CRITICAL";
        else if (zeta > 1.005) regime = "OVERDAMPED";

        const isResonant = (F0 > 0) && (Math.abs(w - w0) / w0 < 0.05);

        const phaseLagRad = Math.atan2(2.0 * zeta * (w / w0), 1.0 - (w / w0) ** 2);
        const phaseLagDeg = (phaseLagRad * 180.0) / Math.PI;

        let odeHTML = "<i>m</i><i>x&#776;</i> + <i>c</i><i>x&#775;</i> + <i>k</i><i>x</i> = <i>F</i><sub>0</sub> cos(<i>&omega;t</i>) + <i>mg</i>";
        if (this.mode === 'buoyancy') {
            odeHTML = "<i>m</i><sub>eff</sub><i>x&#776;</i> + <i>c</i><sub>visc</sub><i>x&#775;</i> + <i>&rho;</i><sub>f</sub><i>g&pi;</i>(<i>R</i><sup>2</sup><i>x</i> &minus; <sup>1</sup>&frasl;<sub>3</sub><i>x</i><sup>3</sup>) = <i>F</i><sub>0</sub> cos(<i>&omega;t</i>)";
        } else if (this.mode === 'maglev') {
            odeHTML = "<i>m</i><i>x&#776;</i> + <i>c</i><sub>eddy</sub><i>x&#775;</i> + <i>k</i><sub>mag</sub><i>x</i>(1 + <i>&beta;x</i><sup>2</sup>) = <i>F</i><sub>0</sub> cos(<i>&omega;t</i>) + <i>mg</i>";
        }

        let formulaHTML = "<i>x</i>(<i>t</i>) = <i>A</i> cos(<i>&omega;</i><sub>0</sub><i>t</i> &minus; <i>&phi;</i>) + <i>x</i><sub>eq</sub>";
        if (F0 > 0) {
            formulaHTML = "<i>x</i><sub>p</sub>(<i>t</i>) = [<i>F</i><sub>0</sub> / &radic;((<i>k</i>&minus;<i>m&omega;</i><sup>2</sup>)<sup>2</sup> + (<i>c&omega;</i>)<sup>2</sup>)] cos(<i>&omega;t</i> &minus; <i>&delta;</i>) + <i>x</i><sub>eq</sub>";
        } else if (regime === "UNDERDAMPED") {
            formulaHTML = "<i>x</i>(<i>t</i>) = <i>A</i> e<sup>&minus;<i>&zeta;&omega;</i><sub>0</sub><i>t</i></sup> cos(<i>&omega;</i><sub>d</sub><i>t</i> &minus; <i>&phi;</i>) + <i>x</i><sub>eq</sub>";
        } else if (regime === "CRITICAL") {
            formulaHTML = "<i>x</i>(<i>t</i>) = (<i>C</i><sub>1</sub> + <i>C</i><sub>2</sub><i>t</i>) e<sup>&minus;<i>&omega;</i><sub>0</sub><i>t</i></sup> + <i>x</i><sub>eq</sub>";
        } else if (regime === "OVERDAMPED") {
            formulaHTML = "<i>x</i>(<i>t</i>) = <i>C</i><sub>1</sub> e<sup><i>r</i><sub>1</sub><i>t</i></sup> + <i>C</i><sub>2</sub> e<sup><i>r</i><sub>2</sub><i>t</i></sup> + <i>x</i><sub>eq</sub>";
        }

        const T = 0.5 * m * (v * v);
        const { uEff, usRaw, ugRaw } = this.getRestoringForceAndPotential(x);
        const Emech = T + uEff;
        const Eclosed = T + uEff + qLoss;

        return {
            w0, wd, zeta, qFactor, xEq, regime, isResonant,
            phaseLagDeg, odeHTML, formulaHTML,
            T, Us: usRaw, Ug: ugRaw, Ueff: uEff, qLoss, wDrive, Emech, Eclosed
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
    hudRigTitle: document.getElementById('hud-rig-title'),
    hudPauseBadge: document.getElementById('hud-pause-badge'),
    hudScopeEq: document.getElementById('hud-scope-eq'),
    lblM: document.getElementById('lbl-m'),
    lblK: document.getElementById('lbl-k'),
    lblC: document.getElementById('lbl-c'),
    ode: document.getElementById('ode-readout'),
    formula: document.getElementById('formula-readout'),
    wd: document.getElementById('wd-readout'),
    delta: document.getElementById('delta-readout'),
    qFactor: document.getElementById('qfactor-readout'),
    regime: document.getElementById('regime-readout'),
    w0: document.getElementById('w0-readout'),
    zeta: document.getElementById('zeta-readout'),
    xEq: document.getElementById('xeq-readout'),
    energy: document.getElementById('energy-readout'),
    time: document.getElementById('time-readout'),
    eKin: document.getElementById('e-kin-readout'),
    eUeff: document.getElementById('e-ueff-readout'),
    eUs: document.getElementById('e-us-readout'),
    eUg: document.getElementById('e-ug-readout'),
    eQloss: document.getElementById('e-qloss-readout'),
    eWdrive: document.getElementById('e-wdrive-readout'),
    btnPause: document.getElementById('btn-pause'),
    btnAudio: document.getElementById('btn-audio')
};

const sliderConfigs = [
    { id: 'slider-m', key: 'm', valId: 'val-m', unit: 'kg', dec: 2, resetE: true },
    { id: 'slider-k', key: 'k', valId: 'val-k', unit: 'N/m', dec: 0, resetE: true },
    { id: 'slider-c', key: 'c', valId: 'val-c', unit: 'N·s/m', dec: 2, resetE: false },
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

    if (mode === 'tether') {
        UI.modeSubtitle.innerText = 'ORBITAL TETHER PAYLOAD';
        UI.hudRigTitle.innerText = 'RIG: LINEAR ELASTIC TETHER';
        UI.lblM.innerText = 'PAYLOAD MASS';
        UI.lblK.innerText = 'TETHER STIFFNESS';
        UI.lblC.innerText = 'HYSTERESIS DAMPING';
        Physics.params.g = 0.0;
    } else if (mode === 'buoyancy') {
        UI.modeSubtitle.innerText = 'HYDROSTATIC BUOYANCY SPHERE';
        UI.hudRigTitle.innerText = 'RIG: ARCHIMEDES FLUID TANK';
        UI.lblM.innerText = 'EFF. BUOY MASS';
        UI.lblK.innerText = 'BUOYANCY STIFFNESS';
        UI.lblC.innerText = 'VISCOUS FLUID DRAG';
        if (Physics.params.g < 1.0) Physics.params.g = 9.8;
    } else if (mode === 'maglev') {
        UI.modeSubtitle.innerText = 'HELMHOLTZ MAGLEV TRAP';
        UI.hudRigTitle.innerText = 'RIG: MAGNETIC FLUX CAVITY';
        UI.lblM.innerText = 'CORE MASS';
        UI.lblK.innerText = 'MAGNETIC STIFFNESS';
        UI.lblC.innerText = 'EDDY-CURRENT DRAG';
        Physics.params.g = 0.0;
    }

    Physics.resetState(2.2);
    syncSlidersFromParams();
    Diagnostics.clear();
}

document.getElementById('mode-tether').addEventListener('click', () => switchApparatus('tether'));
document.getElementById('mode-buoyancy').addEventListener('click', () => switchApparatus('buoyancy'));
document.getElementById('mode-maglev').addEventListener('click', () => switchApparatus('maglev'));

function applyPreset(presetName) {
    Physics.isPaused = false;
    UI.btnPause.innerText = '[SPACE] PAUSE';
    UI.hudPauseBadge.classList.add('hidden');

    if (presetName === 'undamped') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.c = 0.0;
        Physics.params.F0 = 0.0;
        Physics.resetState(2.5);
    } else if (presetName === 'underdamped') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.c = 1.5;
        Physics.params.F0 = 0.0;
        Physics.resetState(2.8);
    } else if (presetName === 'critical') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.c = 2.0 * Math.sqrt(Physics.params.k * Physics.params.m);
        Physics.params.F0 = 0.0;
        Physics.resetState(3.2);
    } else if (presetName === 'overdamped') {
        Physics.params.m = 3.0;
        Physics.params.k = 20.0;
        Physics.params.c = 26.0;
        Physics.params.F0 = 0.0;
        Physics.resetState(3.2);
    } else if (presetName === 'resonance') {
        Physics.params.m = 2.0;
        Physics.params.k = 25.0;
        Physics.params.c = 0.45;
        Physics.params.F0 = 8.0;
        Physics.params.w = Math.sqrt(Physics.params.k / Physics.params.m);
        Physics.resetState(0.0);
    }

    syncSlidersFromParams();
    Diagnostics.clear();
}

function triggerImpulse() {
    Physics.state.v += 6.0;
    Physics.resetEnergyLedger();
    SoundEngine.playImpulseStrike();
}

function togglePause() {
    Physics.isPaused = !Physics.isPaused;
    UI.btnPause.innerText = Physics.isPaused ? '[SPACE] RESUME' : '[SPACE] PAUSE';
    UI.hudPauseBadge.classList.toggle('hidden', !Physics.isPaused);
}

function resetSimulation() {
    Physics.resetState(2.0);
    Diagnostics.clear();
}

function toggleAudio() {
    const active = SoundEngine.toggle();
    UI.btnAudio.innerText = active ? '[M] AUDIO: ON' : '[M] AUDIO: OFF';
    UI.btnAudio.classList.toggle('active', active);
}

document.getElementById('btn-undamped').addEventListener('click', () => applyPreset('undamped'));
document.getElementById('btn-underdamped').addEventListener('click', () => applyPreset('underdamped'));
document.getElementById('btn-critical').addEventListener('click', () => applyPreset('critical'));
document.getElementById('btn-overdamped').addEventListener('click', () => applyPreset('overdamped'));
document.getElementById('btn-resonance').addEventListener('click', () => applyPreset('resonance'));
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

function drawTetherApparatus(xEq) {
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
        if (Physics.params.c > 0) {
            const sleeveHeight = Math.max(8, Math.floor(length * 0.45));
            const sleeveWidth = Math.round(6 + (Physics.params.c / 30) * 12);
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
        3
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

function drawMaglevApparatus(xEq) {
    const bounds = getPayloadBounds();
    const topCoilY = 16;
    const botCoilY = 236;

    for (let mLine = -3; mLine <= 3; mLine++) {
        if (mLine === 0) continue;
        const spread = mLine * 14;
        const midDeflect = spread * (1.25 - (bounds.centerY - UNEXTENDED_Y) * 0.004);
        const fluxColor = Physics.params.F0 > 0 ? '#FF0044' : '#222222';
        drawPixelLine(RIG_CENTER_X + spread * 0.5, topCoilY + 14, RIG_CENTER_X + midDeflect, bounds.centerY, fluxColor, 1);
        drawPixelLine(RIG_CENTER_X + midDeflect, bounds.centerY, RIG_CENTER_X + spread * 0.5, botCoilY, fluxColor, 1);
    }

    drawEquilibriumMarkers(xEq);

    const coilPulse = Physics.params.F0 > 0 && Math.cos(Physics.state.phi) > 0 ? '#FF0044' : '#FFB000';
    ctx.fillStyle = '#555555';
    ctx.fillRect(RIG_CENTER_X - 48, topCoilY, 96, 14);
    ctx.fillRect(RIG_CENTER_X - 48, botCoilY, 96, 14);

    ctx.fillStyle = coilPulse;
    for (let x = RIG_CENTER_X - 42; x < RIG_CENTER_X + 42; x += 12) {
        ctx.fillRect(x, topCoilY + 2, 8, 10);
        ctx.fillRect(x, botCoilY + 2, 8, 10);
    }

    const isActiveSelect = Interaction.isDragging || Interaction.isHovering;
    drawPixelCircle(
        RIG_CENTER_X,
        bounds.centerY,
        bounds.radius,
        isActiveSelect ? '#FFFFFF' : '#00FFFF',
        '#FFB000',
        '#FFFFFF'
    );

    ctx.fillStyle = '#000000';
    drawPixelCircle(RIG_CENTER_X, bounds.centerY, Math.max(4, Math.floor(bounds.radius * 0.45)), '#000000', '#00FF66', null);
}

function drawEnergyBarometer(metrics) {
    const BAR_X = 224;
    const BAR_Y = 14;
    const BAR_W = 20;
    const BAR_H = 224;

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

        const hT = Math.round((metrics.T / totalBudget) * totalPixels);
        const hU = Math.round((metrics.Ueff / totalBudget) * totalPixels);
        const hQ = Math.max(0, totalPixels - hT - hU);

        if (hT > 0) {
            ctx.fillStyle = '#00FFFF';
            ctx.fillRect(innerX, bottomY - hT, innerW, hT);
        }

        if (hU > 0) {
            ctx.fillStyle = '#00FF66';
            ctx.fillRect(innerX, bottomY - hT - hU, innerW, hU);
        }

        if (hQ > 0) {
            ctx.fillStyle = '#FF0044';
            ctx.fillRect(innerX, bottomY - hT - hU - hQ, innerW, hQ);
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

    UI.hudScopeEq.style.top = `${eqPlotY * 2 - 8}px`;

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

    UI.ode.innerHTML = metrics.odeHTML;
    UI.formula.innerHTML = metrics.formulaHTML;
    UI.wd.innerText = metrics.wd.toFixed(2);
    UI.delta.innerHTML = `${metrics.phaseLagDeg.toFixed(1)}&deg;`;
    UI.qFactor.innerHTML = metrics.qFactor;

    UI.regime.innerText = metrics.isResonant
        ? `${metrics.regime} [RESONANCE]`
        : metrics.regime;
    UI.regime.className = metrics.isResonant ? 'warning' : '';
    UI.w0.innerText = metrics.w0.toFixed(2);
    UI.zeta.innerText = metrics.zeta.toFixed(2);
    UI.xEq.innerText = metrics.xEq.toFixed(2);
    UI.energy.innerText = metrics.Emech.toFixed(2);
    UI.time.innerText = Physics.state.t.toFixed(2);

    UI.eKin.innerText = metrics.T.toFixed(2);
    UI.eUeff.innerText = metrics.Ueff.toFixed(2);
    UI.eUs.innerText = metrics.Us.toFixed(2);
    UI.eUg.innerText = metrics.Ug.toFixed(2);
    UI.eQloss.innerText = metrics.qLoss.toFixed(2);
    UI.eWdrive.innerText = metrics.wDrive.toFixed(2);

    drawBaseStage();
    if (Physics.mode === 'tether') {
        drawTetherApparatus(metrics.xEq);
    } else if (Physics.mode === 'buoyancy') {
        drawBuoyancyApparatus(metrics.xEq);
    } else if (Physics.mode === 'maglev') {
        drawMaglevApparatus(metrics.xEq);
    }

    drawEnergyBarometer(metrics);
    drawOscilloscope(metrics.xEq);
    drawPhasePortrait(metrics.xEq);

    requestAnimationFrame(gameLoop);
}

syncSlidersFromParams();
gameLoop();