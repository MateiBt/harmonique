# Harmonique — The Pixel Oscillator Laboratory

Hi guys! I created an interactive, retro-styled physics sandbox and visual simulator as part of Stardance. Here you can experiment with oscillating systems. I've added as much physical features as I could've thought of. I hope it's a project that can help anyone understand oscillations, from starters to people preparing for the olympiad! As a side note I did it more as a challenge too see what I basically learned from the whole Stardance experience. I'm quite happy with the result ngl.

The project can be ran on the web. Thank you for reading the READme and trying the project :v !

---

## What is Harmonique?

The project is made so you can experiment with oscillating systems. Instead of looking at static textbook diagrams, you can grab, stretch, fling, and drive mechanical oscillators with full interactive freedom.

The simulation renders onto an internal low-resolution pixel canvas ($480 \times 270$) scaled up with integer pixel scaling, complete with procedural pixel springs, reactive water tanks with bubble particles, a rolling oscilloscope, a phase-space orbital tracker, and an 8-bit procedural sound synthesizer (I got inspired from desmos graph sounds for this one :).

---

## Key Features

* **Direct Hands-On Manipulation:** Click and drag any oscillator bob to pull it from equilibrium. I made it so it doesn't leave the screen (yes, that's a bug I had in the past).
* **Three Playable Apparatuses:**
  * **Spring & Damper:** Orbital tether rig with an animated driving motor, procedural zig-zag coil, and adjustable hysteresis damping sleeve.
  * **Floating Sphere:** Hydrostatic Archimedes buoyancy tank featuring rising micro-bubbles, dynamic surface wave ripples, and nonlinear spherical-cap water displacement.
  * **Lennard-Jones Bond:** Atomic potential well simulator modeling interatomic forces, complete with repulsion flash particles and potential well depth curves.
* **Live Instrumentation & Diagnostics:**
  * **Rolling Oscilloscope:** Real-time waveform tracker plotting position $x(t)$ over time with a live equilibrium crosshair.
  * **Phase Space Portrait:** Dynamic coordinate plane plotting velocity versus displacement $v(x)$ with color-fading trajectory trails.
  * **Thermodynamic Energy Barometer:** A real-time stacked pixel bar tracking Kinetic Energy ($K$), Potential Energy ($V$), and Dissipated Heat ($Q$).
* **8-Bit Sound Synthesis:** I looked for tutotrials online and I managed to build it using a Web Audio API synthesizer that generates procedural pitch-shifting clicks on equilibrium crossings and low-frequency impact thuds when hitting mechanical stops.
* **Instant Regime Presets:** Most contain one-click configurations to immediately demonstrate textbook phenomena like Resonance, Critical Damping, and slow Adiabatic spring weakening.

---

## Interactive Controls & Keybinds

### Mouse Controls
* **Click & Drag Mass:** Just manually displace the oscillator from its equilibrium position. (trust, it's not that hard) 
* **Fling Mass:** Release the mouse while moving to impart release velocity ($v_0$).
* **Sliders:** Adjust mass, stiffness, damping, driving force, frequency, and gravity in real time.

### Keyboard Shortcuts (if you are that lazy to use them)

| Key | Action | Description |
|---|---|---|
| `Space` | **Pause / Resume** | Freezes the numerical physics solver while keeping diagnostics active. |
| `R` | **Reset** | Centers the mass and clears diagnostic trace buffers. |
| `I` | **Impulse Strike** | Injects an instant $+6.0\text{ m/s}$ velocity kick to the mass. |
| `A` | **Adiabatic $k \to k/2$** | Smoothly weakens the spring by half to watch amplitude expand. |
| `M` | **Toggle Audio** | Turns the 8-bit Web Audio sound effects ON/OFF. |
| `1` | **Preset: Undamped** | Sets damping $b = 0$ for perpetual closed phase-space loops. |
| `2` | **Preset: Underdamped** | Classic decaying sinusoidal ringing with inward phase spirals. |
| `3` | **Preset: Critical Damping** | Exact boundary where the mass snaps to rest without oscillating. |
| `4` | **Preset: Overdamped** | Heavy viscous resistance causing slow monotonic creeping. |
| `5` | **Preset: Resonance** | Matches driving frequency to natural frequency ($\omega = \omega_0$). |

---

## Getting Started

Harmonique can be ran without too much effort, here is the guide I will provide to you:

```bash
# 1. Clone the repository
git clone [https://github.com/your-username/harmonique.git](https://github.com/your-username/harmonique.git)

# 2. Enter the directory
cd harmonique

# 3. Open index.html in your browser
# Double-click index.html in your file manager, or open it directly in your browser:
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows