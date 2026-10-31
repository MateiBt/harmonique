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
const UNEXTENDED_Y = 125;  // Pixel Y where x = 0
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

    getDerivatives: function(x, v, phi) {
        const { m, k, c, F0, g } = this.params;
        const a = (-k * x - c * v + F0 * Math.cos(phi) + m * g) / m;
        return { dx: v, dv: a };
    },

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

        // Hard mechanical boundary stops (inelastic restitution e = 0.25)
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

        const isResonant = (F0 > 0) && (Math.abs(w - w0) / w0 < 0.10);

        const kinetic = 0.5 * m * (this.state.v ** 2);
        const potentialEff = 0.5 * k * ((this.state.x - xEq) ** 2);
        const energy = kinetic + potentialEff;

        return { w0, zeta, xEq, regime, isResonant, energy };
    }
};

// --- 3. PHASE 3 DIAGNOSTICS: PRE-ALLOCATED O(1) RING BUFFERS ---
const BUFFER_SIZE = 220; // Matches 220px instrument viewport width

const Diagnostics = {
    xHistory: new Float32Array(BUFFER_SIZE),
    vHistory: new Float32Array(BUFFER_SIZE),
    head: 0,
    count: 0,

    record: function(x, v) {
        this.xHistory[this.head] = x;
        this.vHistory[this.head] = v;
        this.head = (this.head + 1) % BUFFER_SIZE;
        if (this.count < BUFFER_SIZE) this.count++;
    },

    // Retrieve sample at logical index i in [0 .. count - 1] (0 = oldest)
    getSample: function(i) {
        const start = this.count === BUFFER_SIZE ? this.head : 0;
        const idx = (start + i) % BUFFER_SIZE;
        return {
            x: this.xHistory[idx],
            v: this.vHistory[idx]
        };
    }
};

// --- 4. DOM REFERENCES & SLIDER BINDINGS ---
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

// --- 5. MOUSE INTERACTION CONTROLLER ---
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

// --- 6. STRICT 1-BIT PIXEL PRIMITIVES (ZERO ANTI-ALIASING) ---
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

function drawPixelBezel(x, y, w, h, borderColor) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = borderColor;
    ctx.fillRect(x, y, w, 1);         // Top
    ctx.fillRect(x, y + h - 1, w, 1); // Bottom
    ctx.fillRect(x, y, 1, h);         // Left
    ctx.fillRect(x + w - 1, y, 1, h); // Right
}

// --- 7. PIXEL RENDERING PIPELINE ---
function drawStage() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Left Bay Starfield
    for (let i = 0; i < STAR_COUNT; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#555555' : '#FFFFFF';
        ctx.fillRect(stars[i].x, stars[i].y, 1, 1);
    }

    // Center Structural Bulkhead (x = 240)
    ctx.fillStyle = '#555555';
    ctx.fillRect(240, 0, 2, canvas.height);
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
    ctx.fillStyle = '#555555';
    ctx.fillRect(60, 0, 120, 18);
    ctx.fillStyle = '#000000';
    for (let x = 66; x < 174; x += 10) {
        ctx.fillRect(x, 2, 6, 14);
    }

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

    // 1. Internal Hysteresis Damper Sleeve
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

    // 2. Bresenham Pixel Coil Tether
    const coils = Math.round(8 + (Physics.params.k / 100) * 12);
    const segment = length / coils;
    const wireThickness = Physics.params.k >= 60 ? 2 : 1;

    let prevX = RIG_CENTER_X;
    let prevY = anchorY;

    for (let i = 1; i < coils; i++) {
        const nextX = RIG_CENTER_X + ((i % 2 === 0) ? -9 : 9);
        const nextY = Math.round(anchorY + i * segment);
        drawPixelLine(prevX, prevY, nextX, nextY, '#FFB000', wireThickness);
        prevX = nextX;
        prevY = nextY;
    }
    drawPixelLine(prevX, prevY, RIG_CENTER_X, payloadTopY, '#FFB000', wireThickness);
}

function drawPayload() {
    const bounds = getPayloadBounds();
    const { x, y, size } = bounds;

    const wingY = y + Math.floor(size / 2) - 5;
    ctx.fillStyle = '#FFB000';
    ctx.fillRect(x - 30, wingY, 28, 10);
    ctx.fillRect(x + size + 2, wingY, 28, 10);

    ctx.fillStyle = '#000000';
    for (let offset = 7; offset < 28; offset += 7) {
        ctx.fillRect(x - 30 + offset, wingY, 1, 10);
        ctx.fillRect(x + size + 2 + offset, wingY, 1, 10);
    }

    ctx.fillStyle = (Interaction.isDragging || Interaction.isHovering) ? '#FFFFFF' : '#00FFFF';
    ctx.fillRect(x, y, size, size);

    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
    ctx.fillStyle = '#00FFFF';
    ctx.fillRect(x + 6, y + 6, size - 12, size - 12);
}

// --- 8. DIAGNOSTICS RENDERER (OSCILLOSCOPE & PHASE PORTRAIT) ---
function drawOscilloscope(xEq) {
    const BOX_X = 250;
    const BOX_Y = 14;
    const BOX_W = 220;
    const BOX_H = 104;
    const CENTER_Y = BOX_Y + Math.floor(BOX_H / 2);
    const SCALE_Y = 8.0; // 8 pixels per meter (fits +/- 6.2m)

    drawPixelBezel(BOX_X, BOX_Y, BOX_W, BOX_H, '#555555');

    // Internal Grid Lines
    ctx.fillStyle = '#222222';
    for (let gx = BOX_X + 20; gx < BOX_X + BOX_W; gx += 20) {
        ctx.fillRect(gx, BOX_Y + 1, 1, BOX_H - 2);
    }
    for (let gy = BOX_Y + 26; gy < BOX_Y + BOX_H; gy += 26) {
        ctx.fillRect(BOX_X + 1, gy, BOX_W - 2, 1);
    }

    // Unextended x = 0 Axis (Dim Gray)
    ctx.fillStyle = '#555555';
    ctx.fillRect(BOX_X + 1, CENTER_Y, BOX_W - 2, 1);

    // Static Equilibrium x_eq = mg/k Axis (Emerald Green dashed)
    const eqPlotY = Math.max(
        BOX_Y + 2,
        Math.min(BOX_Y + BOX_H - 3, Math.round(CENTER_Y + xEq * SCALE_Y))
    );
    ctx.fillStyle = '#00FF66';
    for (let gx = BOX_X + 2; gx < BOX_X + BOX_W - 2; gx += 6) {
        ctx.fillRect(gx, eqPlotY, 3, 1);
    }

    // Plot Rolling Waveform x(t)
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

    // Live Trace Head Marker
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(prevPlotX - 1, prevPlotY - 1, 2, 2);
}

function drawPhasePortrait(xEq) {
    const BOX_X = 250;
    const BOX_Y = 132;
    const BOX_W = 220;
    const BOX_H = 128;
    const ORIGIN_X = BOX_X + Math.floor(BOX_W / 2);
    const ORIGIN_Y = BOX_Y + Math.floor(BOX_H / 2);

    const SCALE_X = 16.0; // 16 px/m -> +/- 6.5m fits inside 220px width
    const SCALE_V = 2.2;  // 2.2 px/(m/s) -> +/- 28 m/s fits inside 128px height

    drawPixelBezel(BOX_X, BOX_Y, BOX_W, BOX_H, '#555555');

    // Internal Grid
    ctx.fillStyle = '#222222';
    for (let gx = BOX_X + 20; gx < BOX_X + BOX_W; gx += 20) {
        ctx.fillRect(gx, BOX_Y + 1, 1, BOX_H - 2);
    }
    for (let gy = BOX_Y + 21; gy < BOX_Y + BOX_H; gy += 21) {
        ctx.fillRect(BOX_X + 1, gy, BOX_W - 2, 1);
    }

    // Coordinate Axes (x = 0, v = 0)
    ctx.fillStyle = '#555555';
    ctx.fillRect(BOX_X + 1, ORIGIN_Y, BOX_W - 2, 1);
    ctx.fillRect(ORIGIN_X, BOX_Y + 1, 1, BOX_H - 2);

    // Shifted Equilibrium Attractor Crosshair (x = x_eq, v = 0)
    const eqPlotX = Math.max(
        BOX_X + 3,
        Math.min(BOX_X + BOX_W - 4, Math.round(ORIGIN_X + xEq * SCALE_X))
    );
    ctx.fillStyle = '#00FF66';
    ctx.fillRect(eqPlotX - 3, ORIGIN_Y, 7, 1);
    ctx.fillRect(eqPlotX, ORIGIN_Y - 3, 1, 7);

    // Plot Phase Trajectory (x, v) with 3-tier indexed color decay
    const count = Diagnostics.count;
    if (count < 2) return;

    function mapToPhaseBox(sample) {
        const px = Math.round(ORIGIN_X + sample.x * SCALE_X);
        const py = Math.round(ORIGIN_Y - sample.v * SCALE_V); // +v is upward
        return {
            x: Math.max(BOX_X + 1, Math.min(BOX_X + BOX_W - 2, px)),
            y: Math.max(BOX_Y + 1, Math.min(BOX_Y + BOX_H - 2, py))
        };
    }

    let prevPt = mapToPhaseBox(Diagnostics.getSample(0));

    for (let i = 1; i < count; i++) {
        const curPt = mapToPhaseBox(Diagnostics.getSample(i));
        const ageRatio = i / count;

        // Indexed color stepping (Zero alpha blending)
        let segColor = '#222222';
        if (ageRatio > 0.75) segColor = '#00FFFF';
        else if (ageRatio > 0.35) segColor = '#555555';

        drawPixelLine(prevPt.x, prevPt.y, curPt.x, curPt.y, segColor, 1);
        prevPt = curPt;
    }

    // Current Phase State Cursor (3x3 Phosphor Amber Block)
    ctx.fillStyle = '#FFB000';
    ctx.fillRect(prevPt.x - 1, prevPt.y - 1, 3, 3);
}

function drawDiagnosticsLabels() {
    ctx.font = 'bold 8px Courier New, monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('OSCILLOSCOPE: X(T) [M VS TIME]', 250, 10);
    ctx.fillText('PHASE SPACE: V(X) [M/S VS M]', 250, 128);
}

// --- 9. MAIN LOOP ---
const TIME_STEP = 1 / 60;

function gameLoop() {
    if (!Interaction.isDragging) {
        Physics.stepRK4(TIME_STEP);
    }

    // Record instantaneous state into O(1) circular buffers
    Diagnostics.record(Physics.state.x, Physics.state.v);

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

    // Render Physical Stage (Left Bay)
    drawStage();
    drawEquilibriumMarkers(metrics.xEq);
    const anchorY = drawTrussAndActuator();
    const bounds = getPayloadBounds();
    drawTetherAndDamper(anchorY, bounds.y);
    drawPayload();

    // Render Diagnostic Instruments (Right Bay)
    drawDiagnosticsLabels();
    drawOscilloscope(metrics.xEq);
    drawPhasePortrait(metrics.xEq);

    requestAnimationFrame(gameLoop);
}

gameLoop();