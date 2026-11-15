# Learning guide: football AI

**You'll learn:** how computer-controlled players decide where to run, when to pass and when to shoot, and how difficulty works without cheating. **Prerequisites:** the [game loop](game-loop.md) guide. **Read alongside:** `src/sim/ai/situation.ts`, `teamBrain.ts`, `evaluate.ts`, `tactics.ts`, `goalkeeper.ts`, and `AI_PROFILES` in `src/sim/config.ts`.

## Three layers

```
Situation       what is happening?   ball prediction, who reaches the ball first, threats
   │            (computed once, shared by both teams)
TeamBrain       who does what?       roles: carrier, chaser, presser, markers, supporters, runners
   │
Steering        how do I get there?  arrive / moveTo → a PlayerCommand (like a human's input)
```

AI players produce the **same `PlayerCommand`** a human's input produces. They use the same physics, top speed and kick mechanics. The AI can't do anything a human can't.

## Situation: understanding the moment

Every other step, `Situation.update()` predicts the next 3.2 s of ball flight (64 points, 0.05 s apart) and computes, for every player, the **earliest time they could reach the ball**. Computing this once per tick, not once per player decision, keeps the AI's cost growing linearly with the number of players.

## Roles

`TeamBrain.think()` assigns roles each tick:
- **We have the ball:** a carrier; supporters who offer passes; runners who attack space; others hold the shape of the formation.
- **They have the ball:** one presser on the carrier, cover behind, markers on dangerous opponents, the rest in zonal shape.
- **Loose ball:** the fastest-arriving player chases.
- **Restarts:** a taker; everyone else takes positions for the restart type.

Formation positions (`slotPosition` in `tactics.ts`) slide with the ball, so the team stays compact and goal-side, like a real team.

## Utility AI: how the carrier decides

The ball carrier doesn't follow a script. It lists options (shoot, pass to each team-mate, dribble in several directions, hold, clear) and gives each a **utility score**:

```
pass utility ≈ chance it arrives (evaluatePass) + how much better the receiver's position is − risk
shot utility ≈ chance of scoring (evaluateShot: distance, angle, keeper, blockers)
```

The highest score wins. Every option keeps its **reasons**, which you can watch live: open **F3** in a match, under *AI decision*. See [ADR 0006](../architecture/decisions/0006-explainable-utility-ai.md).

## Creating chances in 11v11

On a big pitch with ten defenders, most passes into the penalty area are genuinely blocked. Measuring showed the AI made one pass in 332 attacking-third decisions: there was rarely anyone ahead to pass to, so carriers dribbled into crowds. Real teams fill the box and go round the block, and so does the AI now:
- **Attacking spots:** once a team-mate carries the ball within about 26 m of goal, forwards and then midfielders take distinct spots: near post, penalty spot, far post, and the edge of the box for a cut-back. Each is kept onside (`boxTarget` in `teamBrain.ts`).
- **Wide play:** a pass to a wide player who can cross counts as progress when team-mates are in the box.
- **Crosses and shots** are allowed at realistic odds, including edge-of-box shots when nothing better is on.
- **Pass risk:** a pass is lost to the first defender who gets there, so only the two most dangerous count (`evaluatePass`).

## Difficulty is cognition, not physics

Every level uses the same speeds and physics. What changes (`AI_PROFILES`):
- `reaction`: how long before players respond to a change;
- `decisionInterval`: how often the carrier reconsiders;
- `decisionNoise`: random error added to utility scores, seeded and deterministic, so weaker AI sometimes picks a worse option;
- `passError`, `shotError`: aim error;
- `press`, `intercept`, `tackle`: willingness and timing in defence;
- `gkReaction`, `gkPositioning`: the keeper's speed of response and angle play.

A Beginner team isn't slower. It thinks later and chooses worse. That keeps the game fair and teaches real football: space and timing matter.

## Measuring AI changes

AI results are noisy: one match proves nothing. Use many seeds:
- `npm run report:ai`: decision audit (pass completion, shot quality, clearances);
- `npm run metrics`: gameplay metrics over many simulated matches.

Compare before and after over 30 or more seeds. See [testing](../development/testing.md).

## Try it

- **Exercise I4** explains a decision from the F3 overlay.
- **Exercise I5** writes a clearance test.
- **Exercise A2** improves crosses, measured over many seeds.

All three are in [exercises](exercises.md).
