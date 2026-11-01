# Harmonique

Hi guys, this is harmonique, a small interactive physics project where you can experiment out with oscillating systems.

Most web demos only show theideal case, with no damping force, so I wanted to make something that models different physical potentials—especially the ones from Kevin Zhou's *Mechanics IV: Oscillations* handout:
- a standard linear spring with damping and harmonic driving.
- a sphere floating in water with Archimedes buoyancy (which has a cubic restoring term as the submerged cross-section changes).
- an interatomic bond modeled with the Lennard-Jones potential.

It uses a 4th-order Runge-Kutta (RK4) integrator, and co-integrates dissipated heat so the energy accounting stays consistent.

### How to run it

Just open the link here: https://mateibt.github.io/harmonique/

### Controls

- Mouse: Click and drag the mass to displace it. Fling it to give it an initial velocity.
- Sliders: By using them you can change mass, stiffness, damping, and driving frequency in real time.
-  Some shortcuts I added:
  - `1` - Undamped
  - `2` - Underdamped
  - `3` - Critical damping ($b = 2\sqrt{mk}$)
  - `5` - Resonance ($\omega = \omega_0$)
  - `I` - Velocity impulse kick
  - `Space` - Pause / resume
  - `R` - Reset
  - `M` - Toggle audio ticks

  Note: I made this project was made in the Stardance hackathon, mostly remade the design. The last changes couldn't have been submitted to a devlog due to the fact that the last hour/s of work weren't available on the devlog submission.