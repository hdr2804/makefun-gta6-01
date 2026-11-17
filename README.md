# SOLMAR: Sunset Getaway

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/hdr2804/makefun-gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/hdr2804/makefun-gta6-01/reward.svg)](https://make.fun/c/gta6-01)

An original open-world crime game in the spirit of GTA 6, built for the
make.fun **gta6-01** bounty. You are a getaway driver for hire in Solmar, a
sun-soaked coastal city at golden hour, taking jobs from fixer Marisol Vega:
pickups, timed deliveries, a tail job, a heist, a ferry through roadblocks,
and a final five-star run to the marina boat.

## What is in the game

- A drivable open city: avenues, side streets, beach, marina pier, parks,
  hotels and a lighthouse, all laid out from a fixed seed so every run
  builds the same Solmar.
- Driving and walking: steal any parked or traffic car (the police notice),
  sprint on foot, shove through crowds, jump pads for stunt airtime.
- Traffic that drives the grid and pedestrians who stroll, wait, cross and
  scatter when a car screeches past.
- A wanted system, 0–5 stars: patrol cruisers, pursuing rammers, roadblocks
  at 3 stars, a helicopter spotlight at 4–5. Break line of sight and
  distance to cool down; the safehouse repairs your car and bleeds heat.
- Six chained story missions with briefings, objective markers, timers,
  payouts and speed bonuses, plus near-miss and stunt bonuses, a car
  collection for rare rides, and a safehouse shop for upgrades.
- HUD with cash, wanted stars, objective line, speed, car health, heat and
  a circular minimap (you, police, mission marker, traffic). Start screen,
  phone job list, pause menu, results screen with stats and restart. Saves
  live in localStorage.
- Procedural WebAudio only: engine hum, sirens, skids, crashes and four
  switchable radio stations. No audio files, no network at runtime.

## How to play

Serve the game and open it in desktop Chrome:

```sh
node serve.ts
# open http://localhost:8080
```

Or serve `game/` with any static file server. The game needs no build step
and makes no network request: three.js r170 is vendored as
`game/vendor/three.min.js`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive / walk |
| E | Enter / exit car |
| Space | Handbrake / drift |
| Shift | Sprint on foot |
| M | Phone — take a job from Marisol |
| Enter | Accept a mission briefing |
| R | Switch radio station |
| F | Shove (on foot) |
| B | Safehouse shop (near the safehouse) |
| P / Esc | Pause |

## Screenshots

The four screenshots in `screenshots/` are real renders of this game's own
code: the title screen over the city, a mid-chase drive with the full HUD,
an on-foot pickup with pedestrians and traffic, and the final-job results
screen.

## Tech

- three.js r170 (vendored minified build, `game/vendor/three.min.js`)
- ES modules, no build step, no network at runtime
- `main.ts` copies `game/` and `screenshots/` to `/output` and writes
  `/output/dossier.json` with the kit's `buildDossier`

Solmar is a fictional city. Every name, character, vehicle and story beat
is original — nothing is taken from any commercial game.
