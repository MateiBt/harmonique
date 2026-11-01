var cv = document.getElementById("cv");
var ctx = cv.getContext("2d");

var mode = "spring";
var paused = false;
var adi = false;
var adi_k = 12.5; // target k for adiabatic run

// state: mass, spring k, damping, drive amp, drive freq, gravity
var m = 2.0, k = 25.0, b = 1.5, F0 = 0.0, w = 3.5, g = 0.0;
var x = 2.0, v = 0.0, phi = 0.0, qloss = 0.0, wdrv = 0.0, t = 0.0;
var dt = 1 / 60;

// history for the scope + phase plot
var histX = [];
var histV = [];

// audio, created lazily (browsers block it until a click)
var actx = null, snd = false;
function beep(f, d) {
  if (!snd) return;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  var o = actx.createOscillator(), gn = actx.createGain();
  o.frequency.value = f;
  gn.gain.setValueAtTime(0.04, actx.currentTime);
  gn.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d); // fade out
  o.connect(gn); gn.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + d);
}

// equilibrium shift from gravity (spring only)
function xeq() {
  return mode === "spring" ? (m * g) / k : 0;
}

// force + potential for the current mode
function forces(pos) {
    var u = pos - xeq();
    if (mode === "buoyancy") {
        var R = 3.2, uc = Math.max(-R, Math.min(R, u)); // clamp to sphere radius
        var fb = -k * uc * (1 - (uc * uc) / (3 * R * R));
        var vb = 0.5 * k * uc * uc * (1 - (uc * uc) / (6 * R * R));
        return { f: fb, v: vb, us: vb, ug: -m * g * pos };
    }
    if (mode === "lj") {
        var r0 = 4.5, eps = (k * r0 * r0) / 72;
        var xi = Math.max(0.72, 1 + u / r0); // avoid blowup at small r
        var i6 = Math.pow(xi, -6), i12 = i6 * i6;
        return { f: (12 * eps / r0) * (i12 / xi - i6 / xi), v: Math.max(0, eps * (i12 - 2 * i6 + 1)), us: 0, ug: 0 };
    }
    return { f: -k * pos + m * g, v: 0.5 * k * u * u, us: 0.5 * k * pos * pos, ug: -m * g * pos };
}

// derivatives for rk4
function deriv(pos, vel, ph) {
  var fd = F0 * Math.cos(ph);
  var a = (forces(pos).f - b * vel + fd) / m;
  return { dx: vel, dv: a, dq: b * vel * vel, dw: fd * vel };
}

function step() {
    // slowly ramp k during adiabatic run
    if (adi) {
        k += (adi_k - k) * 0.15 * dt;
        if (Math.abs(k - adi_k) < 0.05) { k = adi_k; adi = false; }
        sync();
    }
    var u0 = x - xeq(); // remember side of eq for the beep
    var k1 = deriv(x, v, phi);
    var k2 = deriv(x + 0.5 * dt * k1.dx, v + 0.5 * dt * k1.dv, phi + 0.5 * dt * w);
    var k3 = deriv(x + 0.5 * dt * k2.dx, v + 0.5 * dt * k2.dv, phi + 0.5 * dt * w);
    var k4 = deriv(x + dt * k3.dx, v + dt * k3.dv, phi + dt * w);

    x += (dt / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
    v += (dt / 6) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);
    qloss += (dt / 6) * (k1.dq + 2 * k2.dq + 2 * k3.dq + k4.dq);
    wdrv += (dt / 6) * (k1.dw + 2 * k2.dw + 2 * k3.dw + k4.dw);
    phi = (phi + w * dt) % (2 * Math.PI);
    t += dt;

    // tick when crossing equilibrium
    if (u0 * (x - xeq()) <= 0) {
        if (Math.abs(v) > 0.2) {
            beep(500 + Math.abs(v) * 30, 0.02);
        }
    }

    // walls: inelastic bounce, lost KE goes to qloss
    if (x < -4.2 || x > 5.2) {
        x = x < -4.2 ? -4.2 : 5.2;
        var vp = v;
        v = -0.25 * vp;
        qloss += 0.5 * m * (vp * vp - v * v);
        beep(120, 0.06);
    }
}

var drag = false, log = [];

// grab the mass
cv.onmousedown = function(e) {
  var r = cv.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  var py = 190 + x * 25;
  if (Math.abs(mx - 140) < 40) {
    if (Math.abs(my - py) < 40) {
      drag = true; v = 0; qloss = 0; wdrv = 0;
      log = [{ y: x, t: performance.now() }];
    }
  }
};

cv.onmousemove = function(e) {
    if (!drag) return;
    var r = cv.getBoundingClientRect();
    x = Math.max(-4.2, Math.min(5.2, (e.clientY - r.top - 190) / 25));
    v = 0; qloss = 0; wdrv = 0;
    var now = performance.now();
    log.push({ y: x, t: now });
    log = log.filter(function(p) { return now - p.t < 60; }); // last 60ms only
};

// release: throw with the measured velocity
window.onmouseup = function() {
  if (!drag) return;
  drag = false;
  if (log.length > 1) {
    var dt_s = (log[log.length - 1].t - log[0].t) / 1000;
    if (dt_s > 0.005) {
      var raw_v = (log[log.length - 1].y - log[0].y) / dt_s;
      v = Math.max(-20, Math.min(20, raw_v)); // cap it
    }
  }
  qloss = 0; wdrv = 0;
};

function set(id, val) { document.getElementById(id).innerHTML = val; }

function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  var eq = xeq();
  var py = 190 + x * 25;
  var eq_y = 190 + eq * 25;

  // panel dividers
  ctx.strokeStyle = "#2e3038";
  ctx.beginPath();
  ctx.moveTo(280, 0); ctx.lineTo(280, 380);
  ctx.moveTo(340, 0); ctx.lineTo(340, 380);
  ctx.moveTo(340, 190); ctx.lineTo(720, 190);
  ctx.stroke();

  // x = 0 line
  ctx.strokeStyle = "#22242a";
  ctx.beginPath(); ctx.moveTo(20, 190); ctx.lineTo(260, 190); ctx.stroke();

  // x_eq dashed
  ctx.strokeStyle = "#34d399";
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(20, eq_y); ctx.lineTo(260, eq_y); ctx.stroke();
  ctx.setLineDash([]);

  // apparatus
  if (mode === "spring") {
    var ay = 30 + (F0 > 0 ? 8 * Math.cos(phi) : 0); // driven anchor wiggles
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(140, ay);
    for (var i = 1; i <= 12; i++) {
      ctx.lineTo(140 + (i % 2 === 0 ? -12 : 12), ay + i * ((py - 18 - ay) / 12)); // zigzag coil
    }
    ctx.lineTo(140, py);
    ctx.stroke();
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(122, py - 18, 36, 36);
  } else if (mode === "buoyancy") {
    ctx.fillStyle = "rgba(56, 189, 248, 0.15)"; // water
    ctx.fillRect(30, 190, 220, 170);
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath(); ctx.arc(140, py, 22, 0, 2 * Math.PI); ctx.fill();
  } else {
    ctx.fillStyle = "#71717a"; // fixed atom
    ctx.beginPath(); ctx.arc(140, 50, 14, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = x < 0 ? "#f43f5e" : "#34d399"; // red when compressed
    ctx.beginPath(); ctx.moveTo(140, 50); ctx.lineTo(140, py); ctx.stroke();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath(); ctx.arc(140, py, 20, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.lineWidth = 1;

  // energy bar: K / V / Q stacked
  var fr = forces(x);
  var K = 0.5 * m * v * v, V = fr.v;
  var etot = K + V + qloss;
  if (etot > 0.001) {
    var ref = F0 > 0 ? Math.max(etot, 50) : etot; // fixed scale when driven
    var H = Math.min(310, (etot / ref) * 310);
    var hk = (K / etot) * H, hv = (V / etot) * H, hq = H - hk - hv;
    ctx.fillStyle = "#38bdf8"; ctx.fillRect(298, 345 - hk, 24, hk);
    ctx.fillStyle = "#34d399"; ctx.fillRect(298, 345 - hk - hv, 24, hv);
    ctx.fillStyle = "#f43f5e"; ctx.fillRect(298, 345 - H, 24, hq);
  }

  // top right: x(t) scope
  ctx.save();
  ctx.beginPath();
  ctx.rect(341, 1, 378, 188);
  ctx.clip();

  ctx.strokeStyle = "#262830";
  ctx.beginPath();
  ctx.moveTo(340, 95); ctx.lineTo(720, 95);
  ctx.stroke();

  // eq line on scope
  var eq_sy = 95 + eq * 12;
  ctx.strokeStyle = "rgba(52, 211, 153, 0.5)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(340, eq_sy); ctx.lineTo(720, eq_sy);
  ctx.stroke();
  ctx.setLineDash([]);

  if (histX.length > 1) {
    ctx.strokeStyle = "#fbbf24";
    ctx.beginPath();
    for (var j = 0; j < histX.length; j++) {
      var sx = 350 + j * 1.5;
      var sy = 95 + histX[j] * 12;
      if (j === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
  ctx.restore();

  // bottom right: phase plot v(x)
  ctx.save();
  ctx.beginPath();
  ctx.rect(341, 191, 378, 188);
  ctx.clip();

  ctx.strokeStyle = "#262830";
  ctx.beginPath();
  ctx.moveTo(340, 285); ctx.lineTo(720, 285);
  ctx.moveTo(530, 190); ctx.lineTo(530, 380);
  ctx.stroke();

  // little cross at equilibrium
  var eq_px = 530 + eq * 22;
  ctx.strokeStyle = "#34d399";
  ctx.beginPath();
  ctx.moveTo(eq_px - 4, 285); ctx.lineTo(eq_px + 4, 285);
  ctx.moveTo(eq_px, 281); ctx.lineTo(eq_px, 289);
  ctx.stroke();

  if (histX.length > 1) {
    ctx.strokeStyle = "#38bdf8";
    ctx.beginPath();
    for (var n = 0; n < histX.length; n++) {
      var px = 530 + histX[n] * 22;
      var pv = 285 - histV[n] * 3.5;
      if (n === 0) ctx.moveTo(px, pv); else ctx.lineTo(px, pv);
    }
    ctx.stroke();

    // current point
    var lx = 530 + histX[histX.length - 1] * 22;
    var lv = 285 - histV[histV.length - 1] * 3.5;
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(lx - 2, lv - 2, 5, 5);
  }
  ctx.restore();

  // labels
  ctx.font = "600 11px 'Bricolage Grotesque', sans-serif";
  ctx.fillStyle = "#71717a";
  ctx.fillText("x_eq", 24, eq_y - 5);
  ctx.fillText("E", 306, 18);
  ctx.fillText("x(t)", 350, 18);
  ctx.fillText("t", 706, 91);
  ctx.fillText("v(x)", 350, 208);
  ctx.fillText("+v", 535, 204);
  ctx.fillText("+x", 698, 281);

  ctx.fillStyle = "#38bdf8"; ctx.fillText("K", 292, 368);
  ctx.fillStyle = "#34d399"; ctx.fillText("V", 306, 368);
  ctx.fillStyle = "#f43f5e"; ctx.fillText("Q", 320, 368);

  // readouts
  var w0 = Math.sqrt(k / m);
  var zt = b / (2 * Math.sqrt(m * k));
  var wd = zt < 1 ? w0 * Math.sqrt(1 - zt * zt) : 0;
  var qf = b > 0.001 ? m * w0 / b : Infinity;
  var den = Math.sqrt(Math.pow(k - m * w * w, 2) + Math.pow(b * w, 2));
  var A0 = den > 0 ? F0 / den : 0;
  var ph_d = Math.atan2(b * w, k - m * w * w) * 180 / Math.PI;
  var wa = qf > 0.71 ? w0 * Math.sqrt(1 - 1 / (2 * qf * qf)) : 0; // no peak if Q too low

  var reg = zt === 0 ? "Undamped" : (zt < 0.99 ? "Underdamped" : (zt <= 1.01 ? "Critical" : "Overdamped"));
  set("o_reg", reg);
  set("o_w0", w0.toFixed(2));
  set("o_zt", zt.toFixed(2));
  set("o_wd", wd.toFixed(2));
  set("o_qf", b > 0.001 ? qf.toFixed(2) : "&infin;");
  set("o_xeq", eq.toFixed(2));
  set("o_amp", A0.toFixed(2));
  set("o_phi", ph_d.toFixed(1) + "&deg;");
  set("o_wa", wa.toFixed(2));
  set("o_wv", w0.toFixed(2));
  set("o_adi", ((2 * Math.PI * (K + V)) / w0).toFixed(2));

  set("o_k", K.toFixed(2));
  set("o_v", V.toFixed(2));
  set("o_us", fr.us.toFixed(2));
  set("o_ug", fr.ug.toFixed(2));
  set("o_q", qloss.toFixed(2));
  set("o_w", wdrv.toFixed(2));
  set("o_e", (K + V).toFixed(2));
  set("o_t", t.toFixed(2));

  // pick the x(t) formula for the current case
  if (F0 > 0) set("o_sol", "x(t) = |A<sub>0</sub>| cos(&omega;t &minus; &phi;) + A<sub>+</sub>e<sup>i&omega;<sub>+</sub>t</sup> + A<sub>&minus;</sub>e<sup>i&omega;<sub>&minus;</sub>t</sup>");
  else if (reg === "Undamped") set("o_sol", "x(t) = A cos(&omega;<sub>0</sub>t &minus; &delta;) + x<sub>eq</sub>");
  else if (reg === "Underdamped") set("o_sol", "x(t) = A e<sup>&minus;(b/2m)t</sup> cos(&omega;<sub>d</sub>t &minus; &delta;) + x<sub>eq</sub>");
  else if (reg === "Critical") set("o_sol", "x(t) = (C<sub>1</sub> + C<sub>2</sub>t) e<sup>&minus;&omega;<sub>0</sub>t</sup> + x<sub>eq</sub>");
  else set("o_sol", "x(t) = C<sub>1</sub>e<sup>&minus;&gamma;<sub>+</sub>t</sup> + C<sub>2</sub>e<sup>&minus;&gamma;<sub>&minus;</sub>t</sup> + x<sub>eq</sub>");
}

// push state back into the sliders
function sync() {
  document.getElementById("s_m").value = m; set("v_m", m.toFixed(1));
  document.getElementById("s_k").value = k; set("v_k", k.toFixed(1));
  document.getElementById("s_b").value = b; set("v_b", b.toFixed(2));
  document.getElementById("s_f").value = F0; set("v_f", F0.toFixed(1));
  document.getElementById("s_w").value = w; set("v_w", w.toFixed(2));
  document.getElementById("s_g").value = g; set("v_g", g.toFixed(1));
}

// sliders (m, k, g also reset the energy tally)
document.getElementById("s_m").oninput = function(e) { m = +e.target.value; qloss = 0; sync(); };
document.getElementById("s_k").oninput = function(e) { k = +e.target.value; qloss = 0; sync(); };
document.getElementById("s_b").oninput = function(e) { b = +e.target.value; sync(); };
document.getElementById("s_f").oninput = function(e) { F0 = +e.target.value; sync(); };
document.getElementById("s_w").oninput = function(e) { w = +e.target.value; sync(); };
document.getElementById("s_g").oninput = function(e) { g = +e.target.value; qloss = 0; sync(); };

// reset to x0 away from eq
function rst(x0) {
  adi = false; x = xeq() + x0; v = 0; phi = 0; qloss = 0; wdrv = 0; t = 0;
  histX = []; histV = []; sync();
}

function setMode(md) {
	mode = md;
	document.getElementById("t_spr").className = md === "spring" ? "tab on" : "tab";
	document.getElementById("t_buoy").className = md === "buoyancy" ? "tab on" : "tab";
	document.getElementById("t_lj").className = md === "lj" ? "tab on" : "tab";
	if (md === "spring") set("o_ode", "m x&#776; + b x&#775; + k(x &minus; x<sub>eq</sub>) = F<sub>0</sub> cos(&omega;t)");
	if (md === "buoyancy") set("o_ode", "m x&#776; + b x&#775; + &rho;g&pi;(R<sup>2</sup>x &minus; x<sup>3</sup>/3) = F<sub>0</sub> cos(&omega;t)");
	if (md === "lj") set("o_ode", "m r&#776; + b r&#775; &minus; (12&epsilon;/r<sub>0</sub>)[(r<sub>0</sub>/r)<sup>13</sup> &minus; (r<sub>0</sub>/r)<sup>7</sup>] = F<sub>0</sub> cos(&omega;t)");
	rst(2.0);
}

document.getElementById("t_spr").onclick = function() { setMode("spring"); };
document.getElementById("t_buoy").onclick = function() { setMode("buoyancy"); };
document.getElementById("t_lj").onclick = function() { setMode("lj"); };

// presets
document.getElementById("b_und").onclick = function() { b = 0; F0 = 0; rst(2.2); };
document.getElementById("b_undp").onclick = function() { b = 1.5; F0 = 0; rst(2.4); };
document.getElementById("b_crit").onclick = function() { b = 2 * Math.sqrt(m * k); F0 = 0; rst(2.8); }; // b = 2 sqrt(mk)
document.getElementById("b_over").onclick = function() { b = 25; F0 = 0; rst(2.8); };
document.getElementById("b_res").onclick = function() { b = 0.4; F0 = 8; w = Math.sqrt(k / m); rst(0); }; // drive at w0
document.getElementById("b_adi").onclick = function() { b = 0; F0 = 0; adi_k = Math.max(5, k * 0.5); adi = true; sync(); };
document.getElementById("b_imp").onclick = function() { v += 6; beep(400, 0.04); };
document.getElementById("b_pau").onclick = function() { paused = !paused; set("b_pau", paused ? "Resume" : "Pause"); };
document.getElementById("b_rst").onclick = function() { rst(2.0); };
document.getElementById("b_aud").onclick = function() { snd = !snd; set("b_aud", snd ? "Audio: On" : "Audio: Off"); };

// main loop
function loop() {
	if (!paused && !drag) step();
	if (!paused) {
		histX.push(x); histV.push(v);
		if (histX.length > 240) { histX.shift(); histV.shift(); } // keep ~4s
	}
	draw();
	requestAnimationFrame(loop);
}

sync();
loop();