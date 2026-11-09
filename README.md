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
4. Check the preview, then press Render MP4 (top right). Untick "Include music" or change the volume if you like.

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

## How exactly the catches match the replay

The page re-plays the catcher from the replay's frames and checks every fruit, droplet and tiny droplet against it, then compares its totals with the counts saved in the replay (fruits, droplets, tiny droplets caught and missed, misses, max combo).

Rules it follows, checked against osu!lazer's catch code and against real replays:

- The catcher's position is read at the object's whole millisecond (an object at 22383.4 ms is checked at 22383 ms).
- If a replay has two frames with the same time, the first one is used.
- Some replays are recorded a few milliseconds off the map's clock (for example from the player's own timing offset), which flips the close calls. When the counts don't match, the page tries shifts of up to 20 ms either way and uses the smallest one that makes every count match exactly, and says so. If no shift does, nothing is changed.
- Catch range, hard rock offsets, tiny droplet positions and the random draws behind them follow lazer.

Most replays match exactly (11 tested: 8 exact, 3 a call or two off). A small difference is expected on very fast maps such as Obsidian, where the catcher crosses the field in a few milliseconds ("hyperwalk"): the game judges each object on a display frame, so one or two calls at the catcher's edge depend on the original player's frame timing and cannot be recovered from the file. When every count is within two of the replay (and the max combo is the same unless the misses differ), the page says "within timing noise" instead of warning. A bigger gap still shows a warning and lists the closest calls.

## Combo and accuracy HUD

- The **Show the HUD / overlay** tick (default on) draws one of two HUDs, picked in the **Overlay style** menu (below). Score, HP and the live pp follow osu!lazer's rules either way.
- Rules follow lazer: each caught fruit or droplet adds 1 to the combo, a missed one resets it; tiny droplets and bananas never change the combo. Accuracy is caught / judged over fruits, droplets and tiny droplets (bananas excluded).
- The page compares its catch result against the counts stored in the replay (300s, 100s, 50s, misses, max combo) and tells you if they differ; if they do, the HUD is not trustworthy for that replay.
- **Score** is lazer's standardised score for catch (CatchScoreProcessor): up to 1,000,000 from fruit, big droplets and tiny droplets, weighted by combo, plus 200 per banana, times the mods' multiplier (EZ, NF, HT, HR, DT/NC, HD, FL, RX). It is not stable's classic score, so it will not match the number in the replay file.
- **HP** follows lazer's CatchHealthProcessor: it drains from the first object to the last (not in breaks), at the rate stable would pick for the map's HP; fruit, droplets and bananas refill it, and a missed fruit or big droplet costs 3% to 20% depending on HP. The bar is drawn plainly (white, amber when low, red when very low); skin `scorebar-*` images are not used, and a replay that failed in the real game is not shown as failed.

## CPOL overlay (tosu overlays, keys)
The **Overlay style** menu picks the look. The default, *CPOL*, recreates the look of CPOL's osu!catch videos with the real tosu overlays *ArtistTitleDifficulty*, *AccuracyPP* and *Combo* (v1.0.2) plus the pp counter *InGame3* v1.004 by Dartandr under the map details (all from the tosu static folder; AccuracyPP's own pp line is replaced by InGame3's counter, whose "if FC" bubble appears after a miss): their own markup and `main.css` are filled with the replay's values at each frame (HTML inside an SVG `foreignObject`, rasterised and drawn on the canvas, so preview and export match). If the browser cannot rasterise it, a plain canvas imitation is used instead. Approximations: InGame3's "if FC" value is the pp of a flawless play (not of the rest-FC'd score), the progress ring runs first to last object, and the windows are drawn wider than tosu's default sizes so nothing clips. Around it: the beatmap background (from the .osz, or a picture you choose) dimmed behind a full-height playfield, a round timer on the map thumbnail, title / artist - mapper / difficulty pill / mods top-left, accuracy and rank (SS, SSH, S, SH, A...) top-right with `live pp / max pp` under it, `combo/max combo` bottom-left, and four key boxes at the right edge. *osu!stable HUD* is the classic skin-based HUD: score (eight digits, rolling up) and accuracy top-right with the song progress pie, a flat HP bar top-left, and the combo bottom-left with its pop on every catch. It uses your skin's number images (`score-0` ... `score-x`, or the `ScorePrefix` / `ComboPrefix` your skin.ini sets), falling back to osu!'s defaults; if your skin has `scorebar-bg` / `scorebar-colour` / `scorebar-ki` (+ `kidanger`, `kidanger2`) they draw the HP bar (a skin can use `scorebar-bg` for the playfield edge lines, or blank images to hide the bar), otherwise a flat bar is drawn because the default skin's bar images are not bundled. The key counter on the right edge uses `inputoverlay-key`. A blank combo font (`ComboPrefix: invis`) hides the combo, and its missing `x` is not replaced by the default one. *osu!lazer HUD* is lazer's default (Argon) gameplay HUD: the two sheared wedges with the segmented score digits and the curved HP bar top-left (with a red "damage" part after a miss), accuracy (with the faint wireframe digits) and the live pp top-right, the combo bottom-left that grows on every catch and flashes red on a miss, and the song progress bar with elapsed and remaining time along the bottom. Positions, sizes and behaviour follow ppy/osu's `Argon*` HUD classes. Approximations: labels and times use the system font instead of Torus, the progress bar's graph is a plain object-density histogram, the key boxes are a stand-in, and the HP bar tube is built from a few strokes instead of lazer's shader.
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

Overlay designs are credited in [CREDITS.md](CREDITS.md).

- `vendor/lzma-d-min.js` (LZMA-JS), `vendor/mp4-muxer.mjs` (mp4-muxer) and `vendor/fflate.mjs` (fflate): MIT.
- Catch constants and juice stream logic follow osu!lazer (MIT).
- **`assets/default-skin/*.png`, `assets/argon/*.png` and `assets/default-sounds/*.wav` are from ppy/osu-resources and licensed CC BY-NC 4.0: free to use with credit, but not for commercial use.** See the `ATTRIBUTION.md` in each folder. If you put this online, keep it free and non-commercial, or replace these images.

## Background video
If the .osz has a beatmap video (an `[Events]` `Video,offset,"file"` line) and the browser can play it (Chrome and Edge: mp4, webm), it is painted behind the playfield from its start offset to its end, dimmed like the picture; before and after it the still background shows. The preview plays it with the song at the map's rate (a long jump re-syncs it); the export seeks it to the exact time of every frame, which makes video exports slower than picture ones. The **Background video** tick turns it off. avi / flv and other formats the browser cannot decode fall back to the picture with a note. The video's own sound is never used. Videos over 300 MB in the .osz are skipped.

## Deploying

GitHub Pages lets browsers cache the JavaScript modules for ten minutes. Every `import` in `src/` and the script tag in `index.html` carry a `?v=...` stamp so a new deploy is picked up straight away; when you change code, replace the stamp everywhere (`grep -rl "?v=" src index.html`), including `src/version.js` and the `app-version` meta tag; a test checks they agree. The page shows the running version at the bottom and says when a newer one is deployed.

## Mods

- **Hidden (HD)** fades fruit the way lazer's `CatchModHidden` does: the fade starts when 60% of the approach time is left and lasts 16% of it, linearly, for fruit, droplets and bananas.
- Mods are listed under the accuracy in the stable HUD (the skin's `selection-mod-*` icons if present, otherwise badges) and as badges under the pp counter in the lazer HUD. NC replaces DT and PF replaces SD.
- **Flashlight (FL)** blacks out everything outside a soft circle around the catcher (`CatchModFlashlight`): radius 203 playfield units, x0.885 from 100 combo, x0.77 from 200, x1.54 during breaks, gliding between sizes at about 1.15 x the default per second.
- Relax, Autoplay and Cinema replays render normally (the cursor path is in the replay); they just have no special visuals. Lazer-only mods are not in stable `.osr` flags and are not read.

## Storyboards

A map's storyboard (the `.osb` in the `.osz` plus the storyboard lines of the difficulty) replaces the still background image (a background video still plays beneath it) and is drawn beneath the playfield, and the Overlay layer on top of the fruit. Supported: Sprite and Animation objects, the Background / Pass / Foreground / Overlay layers, the commands F, S, V, R, M, MX, MY, C and P (flip H/V and additive A), all 35 easings, and Loop groups. The *Storyboard* checkbox turns it off. The background dim also darkens the storyboard (as in the game), so lower it to see the storyboard clearly.

Not supported yet: Trigger (T) groups (HitSound / Passing / Failing), the Fail layer, storyboard sound samples, `@2x` images, and 4:3 clipping of non-widescreen storyboards. Storyboard images are read from the `.osz` (up to 1500 of them), so a storyboard needs the `.osz` rather than a lone `.osu`.

Performance: only sprites alive at the current time are evaluated and drawn, sprites that miss the frame are skipped, tinted images are cached (colours are quantised: 16 levels per channel for small sprites, 256 for large ones; 192 MB cap), images are decoded no larger than they can appear at 1080p and within a 256 MB budget, and every image is drawn once after loading so the browser uploads it to the GPU before playback. (Ideas from [daladal/replayviewer-js](https://github.com/daladal/replayviewer-js), which also batches sprites through WebGL for particle-heavy storyboards; this renderer does not.)

Preview speed: the *Preview quality* setting only changes the size of the on-screen preview (Auto = up to 720p, stepping down to 540p and 360p if playback drops under about 40 fps; Full = same as the video). The video is always rendered at the resolution you chose. The storyboard also skips sprites that are almost transparent or off the frame, and everything beneath an opaque JPEG sprite that covers the frame.

## Render part of a map, and several replays at once

- **Render from … to …** (under the settings) renders only that part of the map. Times are m:ss counted from the map's first object, like the preview clock; leave a box empty for the start or the end. *Use preview time* copies the preview position into a box, *Whole map* clears both. The music, hitsounds and HUD all follow the range.
- **Several replays:** pick more than one `.osr` file in the replay box (hold Ctrl or Shift). A *Previewing* menu chooses which one you see, and *Render all N replays* makes one MP4 per replay with the current settings and range. If the loaded `.osz` holds several difficulties, each replay is matched to its own. Replays with no matching difficulty are skipped and listed when the run finishes. Cancel stops the batch and keeps the videos already finished.

## The page layout

The page is a single-screen studio: the preview and its transport bar fill the left, and a settings panel with four tabs (Files, Look, Sound, Render) sits on the right, so nothing needs scrolling to change a setting. Render MP4, Render all, Cancel and the progress line live in the top bar. The Logs button in the top bar opens a small panel under it (an error opens it by itself; click elsewhere or press Esc to close). Finished videos replace the preview in the same spot, with a Preview / Video switch above it to flip back. Chips under the stage summarise the loaded replay, map, music and skin. You can drop files anywhere on the page and each goes to the right picker. Space plays and pauses. Resolution, frame rate, bitrate, overlay style, preview quality and the dim and volume sliders are remembered between visits. On a phone the preview stays pinned at the top while the settings scroll beneath it. The page chrome is in `src/ui.js`; it never touches rendering.

## Long renders and memory

The finished MP4 is collected in 16 MB pieces rather than one big buffer, so long, high-bitrate renders no longer fail with "Array buffer allocation failed". The whole file is still held in memory until you download it (about 90 MB per minute at 12 Mbps), so for very long maps lower the bitrate, render a range, or split the map.

## Render speed

The storyboard is drawn at 360p (up to 720p when the background dim is under 50%) and scaled up under the dim, because storyboard drawing cost is mostly fill rate. In a software-only test browser this halved the export time per frame with a storyboard (62 to 32 ms at 720p) and the picture differs from the full-size draw by at most 25 of 255 levels. Frames without a storyboard cost about 16 ms at 720p in the same browser, mostly the browser's own drawing and encoding, which a GPU and a hardware encoder do far faster.

## Getting the map

Picking a replay starts a download of its map straight away (found by the replay's beatmap hash). If that cannot find it, paste the beatmap set link or ID in the Beatmap box and press Download beatmap. For maps that are not uploaded or are custom, open "Unuploaded or custom map?" and add the .osz, or the song plus the .osu. Choosing your own files cancels a lookup that is still running.

## Custom style and the Layout tab

The Custom style replaces the old fixed CPOL look. It has seven widgets: map details, pp counter, accuracy and rank, and combo (the same tosu overlays CPOL used), plus key presses, hit counts (fruits, droplets, tiny droplets, misses) and a progress bar. Each one can be shown or hidden, dragged anywhere on the preview, and resized from the Layout tab. Edges and the centre lines snap while dragging (hold Alt to turn that off), and the arrow keys nudge the selected widget. Positions are saved as fractions of the frame, so a layout looks the same at 480p and 1080p, and they are remembered in this browser. The default layout is the old CPOL arrangement. Most widgets also have several looks to choose from in the same tab (for example three map-details looks and four pp counters); each is a native recreation of a community tosu overlay, credited in CREDITS.md. Every in-game HUD piece also has an osu!lazer (Argon) and an osu!stable look, so you can mix them, and there are extra Score and Health bar widgets (hidden by default). The Layout tab also keeps layouts: built-in *osu!lazer (Argon)* and *osu!stable* arrangements, your own saved layouts, and export/import of a layout as a `.json` file. Dragging is for the preview only; the outlines never appear in the video.

The layout model is in `src/layout.js` and the editor in `src/layoutui.js`.

## Player picture, country and rank (optional Worker)

The Player card and Name tag can show the player's picture, country and rank. A static page can't hold an osu! API secret, so this uses a tiny Cloudflare Worker that you host yourself (`worker/osu-lookup.js`). Without it, the site still works; you can upload a picture or type a user ID instead.

1. On osu! open Settings → OAuth → New OAuth Application. Callback URL can be anything (e.g. `http://localhost`). Note the Client ID and Client Secret.
2. In Cloudflare create a Worker and paste in `worker/osu-lookup.js`.
3. In the Worker's Settings → Variables add `OSU_CLIENT_ID` (text) and `OSU_CLIENT_SECRET` (secret). Optionally add `ALLOW_ORIGIN` set to `https://8408x.github.io`.
4. The site already points at the Worker in `DEFAULT_LOOKUP` (`src/avatar.js`). If you host your own, change that address. The player named in the replay is looked up automatically.

The secret lives only in Cloudflare. Never put it in the site or the repo.

## Sharing a layout

Layout tab → Copy share link. Anyone who opens the link gets your widget positions, sizes, opacity and looks (not your replay or picture).

## Resolution and file size

Pick anything from 240p to 4K (3840 × 2160) in the Render tab. The bitrate box fills in a sensible value for the size and frame rate (for example 1 Mbps at 240p, 5 Mbps at 720p30, 35 Mbps at 4K30, one and a half times that at 60 fps) and shows it next to the label; type your own number to override it, and it is remembered. File size is about bitrate × length, so a 3.5 minute video at 720p60 (7.5 Mbps) is roughly 200 MB, and at 240p about 25 MB. Very large sizes at 60 fps may not be supported by your browser's video encoder; the page tells you if so, and a lower resolution or 30 fps will work.

## Intro and outro cards

In the Render tab, turn on Intro card (the player's picture, name, rank and the map) and/or Outro card (accuracy, max combo, score, pp and hit counts). They add a few silent seconds before and after the gameplay; the music stays in step with the gameplay.

## Intro and outro cards

Pick a **Card style** (osu!lazer, osu!stable or Simple) in the Render tab. The cards show in the preview too: press Play from the start and the intro runs before the map, the outro after the last object. "Show intro" / "Show outro" display them without playing. The exported video uses the same drawing, so what you see is what you get.

### Online leaderboard

With "Online leaderboard on the outro" ticked, the osu!lazer outro shows the map's real osu!catch top scores (fetched through the Worker, `/scores?checksum=<beatmap md5>`) and adds the replay as the last row. It shows a real place only when that player has a score on the board with the same combo and accuracy, because a replay file's score (stable scoring) can't be compared with the board's (lazer scoring). This needs the updated `worker/osu-lookup.js` pasted into Cloudflare. Without it, or for maps that aren't on osu!, the card keeps the combo graph.

### Smooth numbers

Many community overlays roll their numbers (CountUp, about half a second) instead of jumping. "Smooth numbers" in the Render tab does the same for the pp counter (InGame3 also shows two decimals, like the real overlay). Frames are computed from the last second of the play, so seeking and exporting give the same result. Turn it off for faster exports.
