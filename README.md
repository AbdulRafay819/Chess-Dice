# AUREVAK

*The first to rule. The last to fall.*

Chess movement limited by a die, with an aimed sniping phase. Three.js for the
board, one shared TypeScript rules module for both the browser and the server,
and serverless rooms that run on Vercel.

## Run locally

```bash
npm install
npm run dev
# http://127.0.0.1:5173
```

The Vite dev server also mounts the files in `api/` as real HTTP endpoints, so
rooms work locally with no accounts or external services (state is held in
memory and reset when the dev server restarts). Two browser windows are enough
to play: **Create room**, then **Join** with the six-character code, or open the
`?room=CODE` invite link.

```bash
npm run build      # typecheck + production build into dist/
npm run typecheck  # types only
```

## Modes

The start screen offers three ways to play:

- **Play the computer.** You are White. Casual / Club / Sharp change how the
  opponent weighs material, how much noise it tolerates and how straight it
  aims — never what the rules allow: it rolls its own die and may only pick from
  the squares that roll offered. It also chooses between a move and a snipe on a
  six, and prefers a shot when the target is worth more than the tempo.
- **Two players, one screen.** Hot seat, both colours playable from one browser.
- **Play online.** Create a room and share the six-character code or invite
  link; the other seat can be any browser on the internet.

Rules, rooms and settings are separate screens reachable from the start screen
and from the in-game Menu. Escape steps back, Tab or the arrow keys move
between controls, and `prefers-reduced-motion` (or the setting) shortens camera
moves and skips the check flash.

## Rules

- **Roll first.** Every piece keeps its normal chess movement. The die decides
  how many of the selected piece's legal destinations are offered:
  - roll 1 → one destination, roll 4 → four, roll 6 → six.
  - Rooks, bishops and queens slide any distance along their own lines; kings
    step one square; knights make one L jump; pawns advance one (or two from
    their start square), capture diagonally and promote to a queen.
  - A piece with fewer legal moves than the roll shows all of them.
  - The offer is fixed for the roll: reselecting the same piece shows the same
    squares until the turn is made.
- **A six is a choice:** the six-square move offer, or a snipe.
- **Sniping** locks direction to the shooter's own movement lines. Power maps to
  slide distance through friction, `d = v² / (2μg)` capped at six squares, so a
  full pull travels six squares and half power travels 1.5.
  - Aim error away from the locked line lowers precision; precision plus a
    server-seeded wobble decides whether the line stays true. A veered shot hits
    nothing.
  - The first piece on the line stops the shot. Hitting a friendly piece is a
    miss that costs the turn, but never eliminates your own piece.
  - **Only a king can snipe a king.** For every other shooter the enemy king
    stops the projectile.
- **The game ends** on checkmate, on a sniped king, or when every enemy piece is
  gone. Stalemate is a draw.
- Checkmate is evaluated against every legal move, so it never depends on what
  the next die would roll. Castling and en passant are not part of this variant.

## Architecture

```
Browser ─┐  POST /api/room|join|roll|choice|move|snipe   ┌ Upstash Redis (room state)
         ├─────────────────────────────────────────────>│
Browser ─┘           shared rules validate               └ publish ─> Ably `room-CODE`
     ▲                                                                   │
     └──────────── state push, or GET /api/state polling ◄───────────────┘
```

- `src/shared/` is the only rules implementation: `board.ts` (FEN, attack and
  check detection), `rules.ts` (die-offered moves, turns, win conditions),
  `snipe.ts` (directions, the friction formula and deterministic resolution).
  The browser imports it; so does every API function. They cannot disagree.
- **The server is authoritative.** It rolls the die, validates that a move was
  one of the squares the roll offered, picks the RNG seed and resolves each snipe.
  The public, hashed `moveKey` lets both browsers derive the same offer. The browser sends intent only
  (`{from, angle, power}`) and animates the returned result. The seed never
  reaches a client before the shot is resolved, so a client cannot predict the
  wobble.
- **Rapier is visual only.** It tumbles the die and knocks down the struck
  piece; it never decides an outcome. Both players replay the same server result.
- Rooms are JSON in Redis under `dicechess:room:<CODE>` with a six-hour TTL.
  Each player gets a random token in `localStorage`, so a refresh or dropped
  connection reconnects to the same seat.
- Ably publishes the new state after each accepted action. If the realtime
  channel is unavailable (or not configured at all), clients fall back to
  polling `/api/state`, which is fine for turn-based play.

## Deployment

You need free accounts on [Upstash](https://upstash.com),
[Ably](https://ably.com) and [Vercel](https://vercel.com). Nothing else.

### 1. Upstash Redis (room state)

1. Create a Redis database in the region closest to your Vercel region.
2. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** from the
   database's REST API section.
3. No schema or migration is needed; keys are created on the first room and
   expire after six hours.

### 2. Ably (realtime pushes)

1. Create an app and copy an API key (**ABLY_API_KEY**, format
   `keyName:keySecret`). Keep it server-side; it is never shipped to the browser.
2. `api/realtime.ts` mints a short-lived, subscribe-only token scoped to
   `room-<CODE>`, and the browser authenticates with
   `authUrl: /api/realtime`. `api/_lib/publish.ts` publishes with the key over
   Ably's REST API.
3. If you skip Ably, leave the variable unset: the game still works, purely on
   polling.

### 3. Vercel

1. Push the repository and import it in Vercel. The included `vercel.json` sets
   framework `vite`, build `npm run build`, output `dist`, and an SPA fallback
   that excludes `/api/*`.
2. Add the three environment variables to **Production** and **Preview**:
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ABLY_API_KEY`.
3. Deploy:

   ```bash
   npm i -g vercel
   vercel          # preview
   vercel --prod   # production
   ```

4. Open the deployment in two browsers, create a room in one, join with the code
   in the other. Check `/api/config` returns `{"ok":true,"realtime":true,"redis":true}`
   when both services are configured.

Deployment notes:

- Vercel's Hobby plan is for non-commercial use; commercial use needs a paid
  plan. Upstash and Ably free tiers cover hobby traffic.
- Function and database regions should match to keep each action inside one
  round trip.
- Reads and writes are read-modify-write. Two actions submitted in the same
  instant resolve to one winner because each action is phase-guarded, but a
  high-traffic version would move the mutation into a Lua `EVAL` or a Durable
  Object.

## Optional real 3D pieces

Drop CC0 models into `public/assets/pieces/` as `white-king.glb`,
`black-pawn.glb`, and so on (full list in that folder's README). They are scaled,
centred and lit automatically. Missing files fall back to the procedural
lathe-and-extrusion Staunton set, which is what ships by default.

## Layout

```
api/            serverless room endpoints + shared helpers (Redis, Ably, auth)
src/shared/     rules, board maths, deterministic snipe resolution
src/render/     Three.js stage, board, pieces, die, physics, shot effects
src/ui/         HUD
src/net/        room client: API calls, Ably, polling fallback
src/main.ts     controller: input, aiming, animations, state presentation
public/assets/  optional GLB piece models
```
