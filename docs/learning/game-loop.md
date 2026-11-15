# Learning guide: the game loop

**You'll learn:** how a browser game turns "draw as often as the screen refreshes" into a simulation that behaves identically on every machine. **Prerequisites:** basic TypeScript. **Read alongside:** `src/game/game.ts` (`loop`, `frame`) and `src/game/frames.ts` (`FixedStepClock`).

## The problem

Screens refresh at 60, 120, 144 or 240 Hz, and a busy laptop may manage 25 frames one second and 60 the next. If the game moved the ball by `speed × frameTime` each frame, a shot would travel differently on different machines. Collisions would be missed when a frame took too long, and tests couldn't reproduce a match.

## The solution: a fixed timestep

Open Clutch XI separates **simulation time** from **display time**:
- The simulation always advances in exact steps of **1/120 s** (`SIM_DT` in `src/sim/config.ts`).
- Each display frame, the game works out how much real time passed and runs **as many simulation steps as fit**. That might be 0, 1, 2 or more.
- The time left over (less than one step) is carried to the next frame.

```ts
// src/game/frames.ts (simplified)
advance(dt: number, step: () => void) {
  this.acc += dt;                       // real time waiting to be simulated
  let steps = 0;
  while (this.acc >= this.stepDt && steps < this.maxSteps) {
    this.acc -= this.stepDt;
    steps++;
    step();                             // one exact 1/120 s simulation step
  }
  if (steps >= this.maxSteps) this.acc = 0;   // a stalled tab must not "spiral" trying to catch up
  return { steps, alpha: this.acc / this.stepDt };
}
```

`maxSteps` protects against the **spiral of death**: after a long stall (a background tab, a garbage-collection pause), trying to simulate every missed step would make the next frame slow too, and so on. The game drops the backlog instead.

## Smooth pictures: interpolation

If the screen refreshes at 144 Hz and the simulation runs at 120 Hz, some frames would show the same positions twice and movement would judder. So the renderer keeps **the last two simulation snapshots** (`Frame` objects) and draws positions between them, using `alpha` (how far we are into the next step) as the blend:

```
drawn position = previous + (current − previous) × alpha
```

When a player is teleported (lined up for a restart), blending would draw them sliding across the pitch, so `snapAlpha` detects impossible jumps and snaps instead.

## One frame, in order

`Game.loop` is called by `requestAnimationFrame`:
1. **Pace.** The frame limiter may skip a refresh so frames stay evenly spaced (for example 72 fps on a 144 Hz screen in Balanced mode).
2. **Input.** `InputManager.poll()` merges every device into one `InputFrame`.
3. **Simulate.** `clock.advance(dt, …)` runs `match.step()` zero or more times, capturing a `Frame` after each step.
4. **Interpolate.** `MatchView.interpolate(prev, cur, alpha)`.
5. **Camera,** then **draw.** Last, the adaptive quality controller reviews how long the frame took.

## Why 120 Hz?

Faster steps catch fast contacts (a 30 m/s shot moves 25 cm per step at 120 Hz, but 50 cm at 60 Hz) and make controls feel crisp. The simulation is cheap enough that 120 steps a second costs little. See [ADR 0001](../architecture/decisions/0001-deterministic-fixed-timestep-simulation.md).

## Determinism: the payoff

Because every step is the same size and all randomness comes from a seeded generator (`world.rng`), **the same seed and inputs produce exactly the same match**. That's why `tests/` can play whole matches in milliseconds without a browser, and why a test that fails, fails every time.

## Try it

- **Exercise B1** in [exercises](exercises.md) watches the step count in the F3 panel.
- **Exercise I1** writes a test for `FixedStepClock`.
