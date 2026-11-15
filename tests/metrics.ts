/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { AI_PROFILES, Difficulty, MatchFormat, SIM_DT } from '../src/sim/config';
import { Match } from '../src/sim/match';

/**
 * Gameplay "feel" metrics measured from AI-vs-AI simulations. These are diagnostic proxies for
 * flow and realism (possession length, sprinting, dead time) — not substitutes for playtesting.
 */
export interface GameplayMetrics {
  matches: number;
  playSeconds: number;
  /** Mean length (s) of a team's uninterrupted possession sequence during open play. */
  possessionSeqAvg: number;
  /** Median possession sequence length (s). */
  possessionSeqMedian: number;
  /** Fraction of open play in which some player controls the ball (strict: passes in flight excluded). */
  controlledFrac: number;
  /** Fraction of open play in team possession: controlled, or a pass in flight that reaches a teammate. */
  possessedFrac: number;
  /** Fraction of outfield player-time spent sprinting during open play. */
  sprintFrac: number;
  /** Fraction of outfield player-time walking (< 2.2 m/s). */
  walkFrac: number;
  /** Fraction of outfield player-time jogging (2.2–5.0 m/s). */
  jogFrac: number;
  avgSpeed: number;
  turnoversPerMin: number;
  passesPerMatch: number;
  passCompletion: number;
  shotsPerMatch: number;
  goalsPerMatch: number;
  tacklesPerMatch: number;
  /** Seconds per match not in open play (restarts, stoppages, celebrations). */
  deadSecondsPerMatch: number;
  /** Mean time from the ball going out until the restart is taken. */
  restartLatency: number;
  ballAirFrac: number;
}

export function measure(format: MatchFormat, difficulty: Difficulty, seeds: number[], duration = 180): GameplayMetrics {
  let possT = 0;
  let playT = 0,
    ctrlT = 0,
    sprint = 0,
    walk = 0,
    jog = 0,
    speedSum = 0,
    samples = 0,
    airT = 0;
  let turnovers = 0,
    passes = 0,
    completed = 0,
    shots = 0,
    goals = 0,
    tackles = 0,
    dead = 0;
  const seqs: number[] = [];
  const restartLat: number[] = [];
  for (const seed of seeds) {
    const m = new Match({ mode: 'match', format, difficulty, duration, seed, replays: false, aiOnly: true });
    m.brains[0].profile = AI_PROFILES[difficulty];
    const w = m.world;
    let seqTeam: number | null = null;
    let seqStart = 0;
    let outAt = -1;
    // Pass-in-flight bookkeeping: credited as possession only if a teammate receives it.
    let flight: { team: number; t: number } | null = null;
    let flightT = 0;
    w.events.on('control', (e) => {
      if (flight && w.players[e.playerId].team === flight.team) possT += flightT;
      flight = null;
    });
    w.events.on('kick', (e) => {
      flight = e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob' ? { team: w.players[e.playerId].team, t: w.time } : null;
      flightT = 0;
      if (e.kind === 'shot' || e.kind === 'header' || e.kind === 'chip') shots++;
      if (outAt >= 0 && m.phase === 'playing') {
        restartLat.push(w.time - outAt);
        outAt = -1;
      }
    });
    m.events.on('phase', (e) => {
      if (e.phase === 'stoppage') outAt = w.time;
      if (e.phase === 'goal' || e.phase === 'kickoff') outAt = -1;
    });
    m.events.on('goal', () => goals++);
    const steps = Math.round((duration * 3) / SIM_DT);
    for (let i = 0; i < steps && m.phase !== 'fullTime'; i++) {
      m.step(SIM_DT, null);
      if (m.phase !== 'playing') {
        flight = null;
        dead += SIM_DT;
        if (seqTeam !== null) {
          seqs.push(w.time - seqStart);
          seqTeam = null;
        }
        continue;
      }
      playT += SIM_DT;
      const c = w.controller;
      if (c) {
        ctrlT += SIM_DT;
        possT += SIM_DT;
      } else if (flight) flightT += SIM_DT;
      if (w.ball.pos.y > 1) airT += SIM_DT;
      // Possession sequences: owned by the team that last controlled the ball.
      const team: number | null = c ? c.team : seqTeam;
      if (team !== seqTeam) {
        if (seqTeam !== null) {
          seqs.push(w.time - seqStart);
          turnovers++;
        }
        seqTeam = team;
        seqStart = w.time;
      }
      for (const p of w.players) {
        if (p.isGK) continue;
        samples++;
        speedSum += p.speed;
        if (p.lastSprint && p.speed > 6.2) sprint++;
        else if (p.speed < 2.2) walk++;
        else if (p.speed < 5.0) jog++;
      }
    }
    passes += m.stats[0].passes + m.stats[1].passes;
    completed += m.stats[0].passesCompleted + m.stats[1].passesCompleted;
    tackles += m.stats[0].tackles + m.stats[1].tackles;
  }
  const n = seeds.length;
  const sorted = [...seqs].sort((a, b) => a - b);
  return {
    matches: n,
    playSeconds: +(playT / n).toFixed(1),
    possessionSeqAvg: +(seqs.reduce((a, b) => a + b, 0) / Math.max(1, seqs.length)).toFixed(2),
    possessionSeqMedian: +(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2),
    controlledFrac: +(ctrlT / playT).toFixed(3),
    possessedFrac: +(possT / playT).toFixed(3),
    sprintFrac: +(sprint / samples).toFixed(3),
    walkFrac: +(walk / samples).toFixed(3),
    jogFrac: +(jog / samples).toFixed(3),
    avgSpeed: +(speedSum / samples).toFixed(2),
    turnoversPerMin: +(turnovers / (playT / 60)).toFixed(1),
    passesPerMatch: +(passes / n).toFixed(1),
    passCompletion: +(completed / Math.max(1, passes)).toFixed(2),
    shotsPerMatch: +(shots / n).toFixed(1),
    goalsPerMatch: +(goals / n).toFixed(1),
    tacklesPerMatch: +(tackles / n).toFixed(1),
    deadSecondsPerMatch: +(dead / n).toFixed(1),
    restartLatency: +(restartLat.reduce((a, b) => a + b, 0) / Math.max(1, restartLat.length)).toFixed(2),
    ballAirFrac: +(airT / playT).toFixed(3),
  };
}
