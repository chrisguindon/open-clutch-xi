# Learning guide: ball and player physics

**You'll learn:** how a football flies, bounces, curls and rolls in code, and how players accelerate and turn believably. **Prerequisites:** vectors (x, y, z), and velocity as "metres per second". **Read alongside:** `src/sim/ball.ts` (`Ball.step`), `src/sim/config.ts` (`BALL`, `PLAYER`), `src/sim/player.ts`.

## Coordinates

The pitch lies in the **x–z plane**, with **y pointing up**. x runs goal to goal and z runs touchline to touchline. Distances are in metres, speeds in m/s, and time in seconds. This is the same convention Three.js uses, so the renderer copies positions directly.

## Integrating motion

Each 1/120 s step, the ball's velocity changes because of forces, then its position changes because of velocity:

```ts
v.y -= BALL.gravity * dt;      // gravity pulls down at 9.81 m/s²
pos.addScaled(v, dt);          // position += velocity × time
```

This is **semi-implicit Euler integration**: update the velocity first, then move using the new velocity. It's simple, and stable at small fixed steps, which is another reason for the [fixed timestep](game-loop.md).

## The forces on a flying ball

| Force | Code | Football effect |
|---|---|---|
| **Gravity** | `v.y -= gravity × dt` | Every lob comes down |
| **Air drag**, quadratic: `a = −k·|v|·v` | `airDrag` | Hard shots slow down sharply; long balls hang and drop |
| **Magnus force**: `a = k·(ω × v)` | `magnus` | **Spin curls the ball.** Sidespin bends a free kick; topspin makes a shot dip |

The Magnus force is a **cross product** of spin (ω) and velocity. It's perpendicular to both, which is why a ball spinning about a vertical axis swerves sideways. Spin itself decays slowly in the air (`spinDecay`).

## Bounces and rolling

- **Bounce:** when the ball hits the ground fast enough, its vertical speed reverses and shrinks (`restitution` ≈ 0.6). Harder impacts lose a bit more, because grass absorbs them. Friction bleeds horizontal speed and converts it into rolling spin.
- **Rolling:** on the ground, the ball slows by a constant amount plus an amount proportional to speed (`rollDecel`, `rollDrag`).

That rolling model has a **closed-form solution**, so `groundPassSpeed()` can answer "how hard must I pass to reach my team-mate 20 m away at a comfortable speed?" exactly, without trial and error. The AI and pass assistance both use it.

## Posts and nets

Posts are **capsules** (a line segment with a radius): the ball reflects off them with `postRestitution`. The net is a damped volume that soaks up the ball's speed, so goals look like goals.

## Players

- **Acceleration falls off near top speed.** Players burst away from standing, but the last few tenths of top speed take time.
- **Turning depends on speed:** about 14 rad/s walking, 3.6 rad/s sprinting. A sprinting player can't turn on the spot, which is why changing direction beats a defender.
- **Gait phase:** the simulation tracks where each player is in their stride. Dribble touches happen on the forward-stepping foot, so the animation's foot plants match real touches.
- **The ball is never glued to a player.** Dribbling is a series of real touches. That's what makes tackling and interceptions possible.

## Try it

- **Exercise B2** changes `restitution` and finds the test that notices.
- **Exercise I2** plots a curling free kick with `predictBall`.
- **Exercise A1** adds a new skill move.

All three are in [exercises](exercises.md).
