# osu!catch Replay Renderer

Turns an osu!catch replay (.osr) plus its beatmap difficulty (.osu) into an MP4, entirely in the browser. Rendering is offline and uses a fixed timestep, so it is not tied to real time (it often runs faster than playback) and frame timing is perfectly even.

## Run

```
cd osu-catch-renderer
python3 -m http.server 8000      # or: npm start
```

Open http://localhost:8000 in Chrome or Edge. (ES modules and WebCodecs need http://localhost or https, not file://.)

1. Pick the .osr.
2. Get the map, either:
   - press **Download from mirror** (see "Downloading the map" below), or
   - pick the beatmap set (.osz) in the "Music" box, or
   - pick the exact .osu by hand (a warning appears if it does not match the replay), and optionally a plain song file (mp3, ogg, wav, m4a, flac) for the music.

   With an .osz (picked or downloaded), the difficulty you played is found automatically by matching the replay's beatmap hash, and the song is taken from the set.
3. Optional: pick your skin (.osk). Anything your skin does not provide uses osu!'s default image.
4. Check the preview, then press Render MP4. Untick "Include music" or change the volume if you like.

## Tests

```
npm install
npm test
```

Runs parser, juice stream, catch-logic, skin, .osz, mirror-download (mocked network) and audio (pitch / timing) tests on synthetic data, and writes preview frames to `test/out/`.

## Layout

- `src/osr.js` .osr parser (LZMA via `vendor/lzma-d-min.js`)
- `src/osu.js`, `src/slider.js` .osu parser and slider curves
- `src/catch.js` fruit / droplet / banana generation (ported from osu!lazer), position offsets, hyperdash detection, catch evaluation, mods
- `src/rng.js` lazer's two random number generators (shared by bananas, offsets), checked against `test/rng_ref.py`
- `src/catcher.js` catcher animation state, hyperdash timeline and tint, dash / hyperdash trails and after-image
- `src/mirror.js` downloads the beatmap set for a replay from community mirrors
- `src/osz.js` .osz reader (difficulties, song), matching the replay's hash
- `src/hitsounds.js` which samples each caught fruit / droplet / banana plays, finding the sound files, mixing them into the audio
- `src/audio.js` music for the video: cut to the video's time range, pitch-preserving time-stretch for DT/HT, resampling for NC
- `src/skin.js` skin loading (.osk zip via fflate, skin.ini, @2x, fallback to the bundled default skin)
- `src/score.js`, `src/health.js` combo / accuracy / score and HP over time
- `src/pp.js` osu!catch difficulty and performance (live pp), ported from osu!lazer
- `src/keys.js` the key overlay: left / right / dash inferred from the replay
- `src/render.js` draws one frame with skin sprites (same code for preview and export)
- `src/encode.js` WebCodecs VideoEncoder / AudioEncoder + mp4-muxer
- `src/main.js`, `index.html` UI
- `assets/default-skin/`, `assets/default-sounds/` osu!'s default catch textures and hitsounds (see Licenses)
- `assets/argon/` the segmented digit images of lazer's Argon HUD (see Licenses)
- `src/argon.js` the osu!lazer (Argon) HUD
- `assets/fonts/` Roboto Mono (Apache 2.0), the font the tosu overlays use, so the overlay text matches

## Downloading the map

"Download from mirror" looks the replay's beatmap hash up on a mirror to get the beatmap set id, downloads the set (.osz) and then matches the difficulty by hash, so the result is always the exact map that was played, or you get a warning. You can also paste a set link (`https://osu.ppy.sh/beatmapsets/123456`) or ID to skip the lookup.

- Why not osu.ppy.sh itself: the official API needs a client secret, which cannot live in a web page, and its downloads need a login. Mirrors are public.
- Mirrors tried in order (`MIRRORS` in `src/mirror.js`): mirror.hinamizawa.ai (hash lookup and download routes taken from its documentation), osu.direct (download route only; no confirmed hash lookup), catboy.best (routes written from memory, not verified).
- **A mirror only works from a web page if it sends CORS headers.** This could not be tested against the live servers while building, only with mocked responses, so the first real run is the real test. If every mirror fails, the page says so and you can pick the .osz by hand.
- Mirrors are volunteer-run and rate limited (osu.direct: 120 requests per minute). Each render needs one lookup and one download.
- If you host this publicly and mirrors turn out to block web pages: a tiny server-side proxy (e.g. a Cloudflare Worker) that fetches the set and adds the CORS header fixes it, and can also hold an osu! API key for the official lookup.

## Skins

- Load an `.osk` (a zip, same as stable) or leave it empty for the default osu! look.
- Used files: `fruit-pear / grapes / apple / orange` (+ `-overlay`), `fruit-drop`, `fruit-bananas` (+ `-overlay`), `fruit-catcher-idle / kiai / fail`, and `skin.ini` combo colours (used only when the beatmap has no combo colours of its own) and `HyperDash`, `HyperDashFruit`, `HyperDashAfterImage` (default red).
- `@2x` images are preferred and drawn at half their pixel size. File names are case-insensitive.
- Fruit images are tinted by combo colour; the overlay is not. An overlay is only drawn if it comes from the same skin as the fruit.
- A skin with an idle catcher but no kiai/fail image keeps using its idle image.
- Sprite choice (pear, grapes, apple, orange cycle by object index), sizes and the catcher position follow osu!lazer's legacy catch skin.
- Animated images (`fruit-catcher-idle-0.png`, ...) show only their first frame for now.

## Music

- Beatmap time 0 is audio time 0; the video starts a little before the first fruit, and that exact section of the song is used.
- DT and HT keep the song's pitch (WSOLA time-stretch, like osu!stable); NC speeds it up and raises the pitch. A 4 minute song takes about 3 to 5 seconds to process for DT/HT.
- Audio is encoded as AAC when the browser can, otherwise as Opus (e.g. Linux Chromium). Opus-in-MP4 plays in Chrome, Firefox and VLC, but some Windows apps and editors want AAC. Chrome and Edge on Windows normally have AAC.
- The preview plays the same soundtrack the export would encode (song and hitsounds). The first Play after changing a setting takes a moment to prepare it (a few seconds with DT/HT).
- The song is decoded by the browser (Chrome and Edge: mp3, ogg, wav, m4a, flac). Safari cannot decode ogg.

## Hitsounds

- Tick **Include hitsounds** (default on, with its own volume, default 70%) and each caught fruit, droplet and banana plays its sound at its hit time. Missed objects are silent. It also works without music.
- What plays follows osu!lazer: the object's normal sound plus whistle / finish / clap, with the bank (normal / soft / drum), volume and custom sample number from the .osu, filled in from the timing line when the object leaves them at 0. Juice stream ends and repeats use their own edge sounds; droplets play `slidertick`; tiny droplets are silent; bananas play `catch-banana`, rising slightly in pitch through the shower.
- Sound files are looked up in this order: the beatmap's own files (when its custom sample number is 1 or more), then your skin (.osk with e.g. `soft-hitnormal.wav`), then osu!'s defaults. `.wav`, `.mp3` and `.ogg` all work.
- Hitsounds are panned slightly by x position (like lazer's default 20% positional hitsounds), and DT / NC / HT change their speed and pitch like the music does in the game.
- Not reproduced: the skin.ini `LayeredHitSounds` option, and per-sample file names that differ from the standard pattern are only looked up by the name in the .osu. Mixing is simply added on top of the music and clipped at full scale, so lower the hitsound volume if it distorts.

## Bananas and hyperdashes

- Banana showers (spinners) fall as bananas: spacing, x positions, colours, size and rotation follow osu!lazer. Bananas are counted separately from fruits and droplets, and a missed banana does not turn the catcher to its fail pose.
- Lazer's position offsets are reproduced: bananas get their x from the shared `LegacyRandom(1337)`, tiny droplets are jittered by up to 20 px on every map, and Hard Rock moves fruits the way lazer does.
- Hyperdash fruits (and droplets) glow, found with lazer's detection. After the catcher catches one it tints red until the next object or until the replay's catcher reaches the target, leaves red trails and an after-image; normal dashes leave white trails.
- No dotnet was available while building, so the random generators are checked against an independent Python implementation (`test/rng_ref.py`) rather than against the real game. Compare a few showers and hypers with the real game before trusting them.

## Combo and accuracy HUD

- The **Show the HUD / overlay** tick (default on) draws one of two HUDs, picked in the **Overlay style** menu (below). Score, HP and the live pp follow osu!lazer's rules either way.
- Rules follow lazer: each caught fruit or droplet adds 1 to the combo, a missed one resets it; tiny droplets and bananas never change the combo. Accuracy is caught / judged over fruits, droplets and tiny droplets (bananas excluded).
- The page compares its catch result against the counts stored in the replay (300s, 100s, 50s, misses, max combo) and tells you if they differ; if they do, the HUD is not trustworthy for that replay.
- **Score** is lazer's standardised score for catch (CatchScoreProcessor): up to 1,000,000 from fruit, big droplets and tiny droplets, weighted by combo, plus 200 per banana, times the mods' multiplier (EZ, NF, HT, HR, DT/NC, HD, FL, RX). It is not stable's classic score, so it will not match the number in the replay file.
- **HP** follows lazer's CatchHealthProcessor: it drains from the first object to the last (not in breaks), at the rate stable would pick for the map's HP; fruit, droplets and bananas refill it, and a missed fruit or big droplet costs 3% to 20% depending on HP. The bar is drawn plainly (white, amber when low, red when very low); skin `scorebar-*` images are not used, and a replay that failed in the real game is not shown as failed.

## CPOL overlay (tosu overlays, keys)
The **Overlay style** menu picks the look. The default, *CPOL*, recreates the look of CPOL's osu!catch videos with the real tosu overlays *ArtistTitleDifficulty*, *AccuracyPP* and *Combo* (v1.0.2, from the tosu static folder): their own markup and `main.css` are filled with the replay's values at each frame (HTML inside an SVG `foreignObject`, rasterised and drawn on the canvas, so preview and export match). If the browser cannot rasterise it, a plain canvas imitation is used instead. Approximations: `ppIfRestFced` is the pp of a flawless play (not of the rest-FC'd score), the progress ring runs first to last object, and the windows are drawn wider than tosu's default sizes so nothing clips. Around it: the beatmap background (from the .osz, or a picture you choose) dimmed behind a full-height playfield, a round timer on the map thumbnail, title / artist - mapper / difficulty pill / mods top-left, accuracy and rank (SS, SSH, S, SH, A...) top-right with `live pp / max pp` under it, `combo/max combo` bottom-left, and four key boxes at the right edge. *osu!stable HUD* is the classic skin-based HUD: score (eight digits, rolling up) and accuracy top-right with the song progress pie, a flat HP bar top-left, and the combo bottom-left with its pop on every catch. It uses your skin's number images (`score-0` ... `score-x`, or the `ScorePrefix` / `ComboPrefix` your skin.ini sets), falling back to osu!'s defaults; the HP bar is drawn flat because the default skin's bar images are not bundled. *osu!lazer HUD* is lazer's default (Argon) gameplay HUD: the two sheared wedges with the segmented score digits and the curved HP bar top-left (with a red "damage" part after a miss), accuracy (with the faint wireframe digits) and the live pp top-right, the combo bottom-left that grows on every catch and flashes red on a miss, and the song progress bar with elapsed and remaining time along the bottom. Positions, sizes and behaviour follow ppy/osu's `Argon*` HUD classes. Approximations: labels and times use the system font instead of Torus, the progress bar's graph is a plain object-density histogram, the key boxes are a stand-in, and the HP bar tube is built from a few strokes instead of lazer's shader.
- **pp** is lazer's osu!catch difficulty and performance calculation (`src/pp.js`): the star rating is rebuilt as the map is played (one step per fruit, juice stream or banana shower, like lazer's timed difficulty), and the live pp combines it with the judgements so far. The second number is the pp of a flawless play with the same mods. The port matches an independent Python re-implementation of the same formulas, and star rating and flawless-play pp agree with rosu-pp-js 4.0.1 (MaxOhn/rosu-pp) to within 0.1% (largest gap 0.08%, flawless-play pp with HR) on a 500-fruit test map with NoMod, DT, HR, EZ, HT and HD (the small gap is probably float32 rounding in the original). It has not been checked against the real game, so expect small differences.
- **Keys:** a catch replay stores only the catcher's position and the dash flag, so left and right are *inferred* from which way the catcher moves, and the counts are an estimate of real key presses. The boxes are: left, right, dash, and a spare one.
- Rank letters follow stable (SS, with H for HD or FL).

## Caught fruit on the plate

- Caught fruit land on the plate at their offset from the catcher's centre and pile up (nudged sideways and upward when they would overlap), half size, like lazer's `computePositionInStack`.
- Droplets and bananas do not stay: they pop up and fly off sideways.
- The last object of each combo clears the plate: everything explodes when it was caught, or drops when it was missed (a banana shower's end always explodes). The random nudges use a fixed seed, so the pile is the same in preview and export, but not identical to what the real game rolled.

## Hit lighting and spin

- **Hit lighting** (tick box, default on, like lazer's default) is lazer's legacy hit explosion: every caught object lights up in its combo colour above the plate. Fruit get a tall flash whose size grows with the combo, plus a soft glow; droplets and bananas only the glow. The two images are always osu!'s defaults, as in lazer (a skin cannot replace them). The size uses the combo before the catch; I could not confirm from lazer's code whether the real game feeds it the combo before or after the catch, so flash height may differ a little.
- **Spin:** fruit are tilted by a fixed random angle (up to 20 degrees each way) and droplets spin two full turns while falling, using lazer's stateless random seeded by start time. Caught objects keep the angle they had when caught.

## Nightcore beat

- With NC, the drum loop osu! adds is mixed in (it follows the **Include hitsounds** tick and volume): kick, clap and hat samples on every half beat of the beatmap's timing points, with a cymbal on the first beat of each 4-bar segment. 4/4 and 3/4 maps are handled like lazer; hats only play when the map's slider tick rate is even, as in stable.
- It follows the timing points (BPM changes, omitted first bar line) and is pitched with the speed-up like the other sounds. Samples are looked up in your skin first (`nightcore-kick.wav` etc.), then osu!'s defaults. It starts on the first full beat after the intro.

## Not done yet

- Hidden (HD) fruit fade, and the hit error meter strip some videos show at the bottom
- Catching is checked only at each object's hit time, and the preview counts are approximate, not the official score

## Licenses

- `vendor/lzma-d-min.js` (LZMA-JS), `vendor/mp4-muxer.mjs` (mp4-muxer) and `vendor/fflate.mjs` (fflate): MIT.
- Catch constants and juice stream logic follow osu!lazer (MIT).
- **`assets/default-skin/*.png`, `assets/argon/*.png` and `assets/default-sounds/*.wav` are from ppy/osu-resources and licensed CC BY-NC 4.0: free to use with credit, but not for commercial use.** See the `ATTRIBUTION.md` in each folder. If you put this online, keep it free and non-commercial, or replace these images.

## Deploying

GitHub Pages lets browsers cache the JavaScript modules for ten minutes. Every `import` in `src/` and the script tag in `index.html` carry a `?v=...` stamp so a new deploy is picked up straight away; when you change code, replace the stamp everywhere (`grep -rl "?v=" src index.html`).
