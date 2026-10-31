// --- 1. STATIC BACKGROUND STARFIELD (Left Bay: x in [0, 240]) ---
const STAR_COUNT = 40;
const stars = [];
for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
        x: Math.floor(Math.random() * 238),
        y: Math.floor(Math.random() * 270)
    });
}

// --- 2. PHYSICS SOLVER & STATE MODEL ---
const PIXELS_PER_METER = 20;
const RIG_CENTER_X = 120;
const UNEXTENDED_Y = 125; // Pixel Y where x = 0
const MIN_X_METERS = -4.2; // Top mechanical stop (near truss)
const MAX_X_METERS = 5.8;  // Bottom mechanical stop

const Physics = {
    params: {
        m: 2.0,   // Mass (kg)
        k: 25.0,  // Stiffness (N/m)
        c: 1.5,   // Damping coefficient (N*s/m)
        F0: 0.0,  // External driving force amplitude (N)
        w: 3.5,   // External driving frequency (rad/s)
        g: 0.0    // Local gravitational acceleration (m/s^2)
    },

    state: {
        x: 2.0,   // Displacement from unextended length L0 (m)
        v: 0.0,   // Velocity (m/s)
        phi: 0.0, // Continuous drive phase angle (rad)
        t: 0.0    // Elapsed simulation time (s)
    },

    // Coupled 1st-order ODE derivatives
    getDerivatives: function(x, v, phi) {
        const { m, k, c, F0, g } = this.params;
        const a = (-k * x - c * v + F0 * Math.cos(phi) + m * g) / m;
        return { dx: v, dv: a };
    },

    // 4th-Order Runge-Kutta Integrator with Phase Continuity & Mechanical Stops
    stepRK4: function(dt) {
        const { x, v, phi } = this.state;
        const w = this.params.w;

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
        this.state.phi = (this.state.phi + w * dt) % (2 * Math.PI);
        this.state.t += dt;

        // Enforce hard mechanical boundary stops (inelastic restitution e = 0.25)
        if (this.state.x < MIN_X_METERS) {
            this.state.x = MIN_X_METERS;
            if (this.state.v < 0) this.state.v = -0.25 * this.state.v;
        } else if (this.state.x > MAX_X_METERS) {
            this.state.x = MAX_X_METERS;
            if (this.state.v > 0) this.state.v = -0.25 * this.state.v;
        }
    },

    getMetrics: function() {
        const { m, k, c, F0, w, g } = this.params;
        const w0 = Math.sqrt(k / m);
        const zeta = c / (2 * Math.sqrt(k * m));
        const xEq = (m * g) / k;

        let regime = "UNDAMPED";
        if (zeta > 0 && zeta < 0.99) regime = "UNDERDAMPED";
        else if (zeta >= 0.99 && zeta <= 1.01) regime = "CRITICAL";
        else if (zeta > 1.01) regime = "OVERDAMPED";

        // Flag near-resonant forcing when driving frequency matches w0 within 10%
        const isResonant = (F0 > 0) && (Math.abs(w - w0) / w0 < 0.10);

        // Gauge-invariant mechanical energy relative to static equilibrium xEq
        const kinetic = 0.5 * m * (this.state.v ** 2);
        const potentialEff = 0.5 * k * ((this.state.x - xEq) ** 2);
        const energy = kinetic + potentialEff;

        return { w0, zeta, xEq, regime, isResonant, energy };
    }
};

// --- 3. DOM REFERENCES & SLIDER BINDINGS ---
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const UI = {
    regime: document.getElementById('regime-readout'),
    w0: document.getElementById('w0-readout'),
    zeta: document.getElementById('zeta-readout'),
    xEq: document.getElementById('xeq-readout'),
    energy: document.getElementById('energy-readout'),
    time: document.getElementById('time-readout')
};

function bindSlider(id, paramKey, valId, unit, decimals = 1) {
    const slider = document.getElementById(id);
    const valSpan = document.getElementById(valId);

    slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        Physics.params[paramKey] = val;
        valSpan.innerText = `${val.toFixed(decimals)} ${unit}`;
    });
}

bindSlider('slider-m', 'm', 'val-m', 'kg', 1);
bindSlider('slider-k', 'k', 'val-k', 'N/m', 0);
bindSlider('slider-c', 'c', 'val-c', 'N·s/m', 1);
bindSlider('slider-f0', 'F0', 'val-f0', 'N', 1);
bindSlider('slider-w', 'w', 'val-w', 'rad/s', 1);
bindSlider('slider-g', 'g', 'val-g', 'm/s²', 1);

// --- 4. MOUSE INTERACTION CONTROLLER ---
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
    const size = Math.round(20 + Physics.params.m * 1.8);
    return {
        x: RIG_CENTER_X - Math.floor(size / 2),
        y: payloadY - Math.floor(size / 2),
        size: size
    };
}

canvas.addEventListener('mousedown', (e) => {
    const pos = getCanvasMousePos(e);
    const bounds = getPayloadBounds();

    // Hitbox covers main bus + solar wings
    if (
        pos.x >= bounds.x - 32 &&
        pos.x <= bounds.x + bounds.size + 32 &&
        pos.y >= bounds.y - 6 &&
        pos.y <= bounds.y + bounds.size + 6
    ) {
        Interaction.isDragging = true;
        Interaction.dragHistory = [{ y: Physics.state.x, t: performance.now() }];
        Physics.state.v = 0;
    }
});

canvas.addEventListener('mousemove', (e) => {
    const pos = getCanvasMousePos(e);
    const bounds = getPayloadBounds();

    Interaction.isHovering = (
        pos.x >= bounds.x - 32 &&
        pos.x <= bounds.x + bounds.size + 32 &&
        pos.y >= bounds.y - 6 &&
        pos.y <= bounds.y + bounds.size + 6
    );
    canvas.style.cursor = Interaction.isDragging
        ? 'grabbing'
        : (Interaction.isHovering ? 'grab' : 'default');

    if (!Interaction.isDragging) return;

    const rawX = (pos.y - UNEXTENDED_Y) / PIXELS_PER_METER;
    const clampedX = Math.max(MIN_X_METERS, Math.min(MAX_X_METERS, rawX));
    Physics.state.x = clampedX;

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
    Interaction.dragHistory = [];
}

canvas.addEventListener('mouseup', releasePayload);
canvas.addEventListener('mouseleave', releasePayload);

// --- 5. PIXEL RENDERING PIPELINE ---
function drawStage() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Left Bay Starfield
    for (let i = 0; i < STAR_COUNT; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#555555' : '#FFFFFF';
        ctx.fillRect(stars[i].x, stars[i].y, 1, 1);
    }

    // Divider line between Left Physical Rig (0..240) and Right Diagnostics Bay (240..480)
    ctx.fillStyle = '#555555';
    ctx.fillRect(240, 0, 2, canvas.height);

    // Placeholder grid in Right Bay (Prepared for Phase 3 Diagnostics)
    ctx.fillStyle = '#222222';
    for (let x = 260; x < 480; x += 20) {
        ctx.fillRect(x, 0, 1, canvas.height);
    }
    for (let y = 20; y < 270; y += 20) {
        ctx.fillRect(242, y, 238, 1);
    }
}

function drawEquilibriumMarkers(xEq) {
    // Unextended reference L0 (Dim Gray dashed line)
    ctx.fillStyle = '#555555';
    for (let x = 15; x < 225; x += 8) {
        ctx.fillRect(x, UNEXTENDED_Y, 4, 1);
    }

    // Static Equilibrium x_eq = mg/k (Emerald Green dashed line)
    const eqY = Math.round(UNEXTENDED_Y + xEq * PIXELS_PER_METER);
    const clampedEqY = Math.max(25, Math.min(265, eqY));
    ctx.fillStyle = '#00FF66';
    for (let x = 15; x < 225; x += 6) {
        ctx.fillRect(x, clampedEqY, 3, 1);
    }
}

function drawTrussAndActuator() {
    // Structural Orbital Truss
    ctx.fillStyle = '#555555';
    ctx.fillRect(60, 0, 120, 18);
    ctx.fillStyle = '#000000';
    for (let x = 66; x < 174; x += 10) {
        ctx.fillRect(x, 2, 6, 14);
    }

    // Driven Actuator Piston (oscillates visually when F0 > 0)
    const driveOffset = Physics.params.F0 > 0
        ? Math.round((Physics.params.F0 / 30) * 8 * Math.cos(Physics.state.phi))
        : 0;
    const anchorY = 22 + driveOffset;

    ctx.fillStyle = Physics.params.F0 > 0 ? '#FF0044' : '#FFB000';
    ctx.fillRect(RIG_CENTER_X - 10, anchorY - 4, 20, 6);

    return anchorY + 2;
}

function drawTetherAndDamper(anchorY, payloadTopY) {
    const length = payloadTopY - anchorY;
    if (length <= 2) return;

    // 1. Internal Hysteresis Damper Sleeve (scales with c)
    if (Physics.params.c > 0) {
        const sleeveHeight = Math.max(8, Math.floor(length * 0.45));
        const sleeveWidth = Math.round(6 + (Physics.params.c / 15) * 10);
        ctx.fillStyle = '#222222';
        ctx.fillRect(
            RIG_CENTER_X - Math.floor(sleeveWidth / 2),
            anchorY,
            sleeveWidth,
            sleeveHeight
        );
        ctx.fillStyle = '#555555';
        ctx.fillRect(
            RIG_CENTER_X - Math.floor(sleeveWidth / 2),
            anchorY + sleeveHeight - 2,
            sleeveWidth,
            2
        );
    }

    // 2. Procedural Coil Tether (coil count & wire thickness scale with k)
    const coils = Math.round(8 + (Physics.params.k / 100) * 12);
    const segment = length / coils;
    const wireWidth = Physics.params.k >= 60 ? 2 : 1;

    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = wireWidth;
    ctx.beginPath();
    ctx.moveTo(RIG_CENTER_X, anchorY);

    for (let i = 1; i < coils; i++) {
        const xOffset = (i % 2 === 0) ? -9 : 9;
        ctx.lineTo(RIG_CENTER_X + xOffset, Math.round(anchorY + i * segment));
    }
    ctx.lineTo(RIG_CENTER_X, payloadTopY);
    ctx.stroke();
}

function drawPayload() {
    const bounds = getPayloadBounds();
    const { x, y, size } = bounds;

    // Solar Array Wings
    const wingY = y + Math.floor(size / 2) - 5;
    ctx.fillStyle = '#FFB000';
    ctx.fillRect(x - 30, wingY, 28, 10);
    ctx.fillRect(x + size + 2, wingY, 28, 10);

    // Solar Cell Grid Lines
    ctx.fillStyle = '#000000';
    for (let offset = 7; offset < 28; offset += 7) {
        ctx.fillRect(x - 30 + offset, wingY, 1, 10);
        ctx.fillRect(x + size + 2 + offset, wingY, 1, 10);
    }

    // Satellite Bus Body (scales with mass m)
    ctx.fillStyle = (Interaction.isDragging || Interaction.isHovering) ? '#FFFFFF' : '#00FFFF';
    ctx.fillRect(x, y, size, size);

    // Inner core detail
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
    ctx.fillStyle = '#00FFFF';
    ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
}

// --- 6. MAIN LOOP ---
const TIME_STEP = 1 / 60;

function gameLoop() {
    if (!Interaction.isDragging) {
        Physics.stepRK4(TIME_STEP);
    }

    const metrics = Physics.getMetrics();

    // Update Telemetry Readouts
    UI.regime.innerText = metrics.isResonant
        ? `${metrics.regime} [RESONANCE]`
        : metrics.regime;
    UI.regime.className = metrics.isResonant ? 'warning' : '';
    UI.w0.innerText = metrics.w0.toFixed(2);
    UI.zeta.innerText = metrics.zeta.toFixed(2);
    UI.xEq.innerText = metrics.xEq.toFixed(2);
    UI.energy.innerText = metrics.energy.toFixed(2);
    UI.time.innerText = Physics.state.t.toFixed(2);

    // Render Frame
    drawStage();
    drawEquilibriumMarkers(metrics.xEq);
    const anchorY = drawTrussAndActuator();
    const bounds = getPayloadBounds();
    drawTetherAndDamper(anchorY, bounds.y);
    drawPayload();

    requestAnimationFrame(gameLoop);
}

gameLoop();