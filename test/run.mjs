// Node tests with synthetic data: `npm test`
// Covers md5, .osr parsing (incl. LZMA), .osu parsing, juice stream generation, catch evaluation,
// and (if @napi-rs/canvas is installed) renders a preview PNG to test/out/.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// the browser loads this as a classic <script>; do the same here
vm.runInThisContext(fs.readFileSync(path.join(root, 'vendor/lzma-d-min.js'), 'utf8'));
assert.ok(globalThis.LZMA, 'vendored LZMA decoder defines global LZMA');

const { md5 } = await import('../src/md5.js');
const { parseOsr, parseReplayFrames, modsToString } = await import('../src/osr.js');
const { parseOsu } = await import('../src/osu.js');
const { createPath } = await import('../src/slider.js');
const { buildScene, evaluateCatches, findJudgeShift, modRate, resolveColours, DEFAULT_COLOURS } = await import('../src/catch.js');
const { ReplayTrack } = await import('../src/replay.js');
const { parseSkinIni, readOsk, Skin, loadDefaultSkin, loadOskSkin, describeSkin } = await import('../src/skin.js');
const { zipSync, strToU8 } = await import('../vendor/fflate.mjs');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

// ---------- helpers to build a synthetic .osr ----------
const LZMAenc = require('lzma');
const lzmaCompress = (str) => new Promise((res, rej) => LZMAenc.compress(str, 5, (out, err) => (err ? rej(err) : res(Buffer.from(Uint8Array.from(out, (b) => b & 255))))));

const uleb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const str = (s) => { if (!s) return Buffer.from([0]); const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([0x0b]), uleb(b.length), b]); };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

async function makeOsr({ mode = 2, mods = 0, player = 'Tester', frameText, md5hash = 'a'.repeat(32) }) {
  const data = await lzmaCompress(frameText);
  return Buffer.concat([
    Buffer.from([mode]), i32(20240101), str(md5hash), str(player), str('b'.repeat(32)),
    u16(10), u16(2), u16(1), u16(0), u16(0), u16(0),
    i32(123456), u16(99), Buffer.from([0]), i32(mods), str(''),
    i64(638400000000000000n), i32(data.length), data, i64(0),
  ]);
}
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// ---------- tests ----------
await test('md5 matches node crypto', () => {
  for (const s of ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'osu!catch'.repeat(1000)]) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(md5(bytes), crypto.createHash('md5').update(bytes).digest('hex'), `len ${s.length}`);
  }
  const rnd = crypto.randomBytes(5000);
  assert.equal(md5(rnd), crypto.createHash('md5').update(rnd).digest('hex'));
});

await test('replay frames: skip frames, seed frame, time accumulation', () => {
  const { frames, seed } = parseReplayFrames('0|256|-500|0,-1|256|-500|0,501|100|0|0,100|120|0|1,50|140|0|0,-12345|0|0|777,');
  assert.equal(seed, 777);
  assert.deepEqual(frames.map((f) => f.t), [500, 600, 650]);
  assert.deepEqual(frames.map((f) => f.x), [100, 120, 140]);
  assert.deepEqual(frames.map((f) => f.dash), [false, true, false]);
});

await test('replay frames: negative deltas never go backwards', () => {
  const { frames } = parseReplayFrames('0|256|-500|0,-1|256|-500|0,1001|100|0|0,10|110|0|0,-5|999|0|0,10|120|0|0,');
  const ts = frames.map((f) => f.t);
  assert.deepEqual(ts, [1000, 1010, 1015]); // the -5 frame (t=1005) is dropped
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1]);
});

await test('parseOsr reads header and LZMA frames (decoder from vendor/)', async () => {
  const osr = await makeOsr({
    mods: 16 | 64, player: 'Win', md5hash: 'c'.repeat(32),
    frameText: '0|256|-500|0,-1|256|-500|0,1001|100|0|0,500|300|0|1,-12345|0|0|42,',
  });
  const r = await parseOsr(toAB(osr));
  assert.equal(r.mode, 2);
  assert.equal(r.player, 'Win');
  assert.equal(r.beatmapMd5, 'c'.repeat(32));
  assert.equal(r.mods, 80);
  assert.equal(modsToString(r.mods), 'HRDT');
  assert.equal(r.maxCombo, 99);
  assert.equal(r.score, 123456);
  assert.equal(r.n300, 10);
  assert.equal(r.seed, 42);
  assert.deepEqual(r.frames.map((f) => [f.t, f.x, f.dash]), [[1000, 100, false], [1500, 300, true]]);
  assert.equal(r.date.getUTCFullYear() >= 2020, true);
});

await test('parseOsr rejects truncated files', async () => {
  const osr = await makeOsr({ frameText: '0|1|2|3,' });
  await assert.rejects(() => parseOsr(toAB(osr.subarray(0, 40))), /truncated/);
});

await test('modsToString / modRate', () => {
  assert.equal(modsToString(0), 'NM');
  assert.equal(modsToString(64 | 512), 'NC');
  assert.equal(modRate(64), 1.5);
  assert.equal(modRate(512 | 64), 1.5);
  assert.equal(modRate(256), 0.75);
  assert.equal(modRate(0), 1);
});

await test('slider paths: linear, perfect circle, bezier, extension', () => {
  const lin = createPath('L', [{ x: 0, y: 0 }, { x: 200, y: 0 }], 200);
  near(lin.positionAt(0.5).x, 100); near(lin.positionAt(1).x, 200);

  // quarter circle radius 100 centred at origin: (100,0) -> (0,100) via the 45° point
  const r = 100, c = Math.SQRT1_2 * r;
  const circ = createPath('P', [{ x: 0, y: 0 }, { x: c - r, y: c }, { x: -r, y: r }].map((p) => ({ x: p.x + 0, y: p.y })), (Math.PI / 2) * r);
  const end = circ.positionAt(1);
  near(end.x, -r, 0.5); near(end.y, r, 0.5);
  const mid = circ.positionAt(0.5);
  near(mid.x, c - r, 0.5); near(mid.y, c, 0.5);

  const bez = createPath('B', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 150);
  assert.ok(bez.positionAt(0.5).x > 40 && bez.positionAt(0.5).x < 100);
  near(bez.positionAt(0).x, 0);

  // red anchor: two linear-ish bezier pieces
  const red = createPath('B', [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 100);
  near(red.positionAt(0.5).x, 50, 0.5);

  // declared length longer than the curve: extends along the last segment
  const ext = createPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 150);
  near(ext.positionAt(1).x, 150);
});

const OSU = `osu file format v14

[General]
Mode: 2

[Metadata]
Title:Test Song
Artist:Test Artist
Version:Test Diff

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,1,0,100,1,0
4000,-100,4,1,0,100,0,0

[Colours]
Combo1 : 255,0,0
Combo2 : 0,255,0

[HitObjects]
100,300,1000,5,0,0:0:0:0:
256,300,1500,1,0,0:0:0:0:
100,100,2000,6,0,L|300:100,1,200
256,192,3500,12,0,3800
400,300,5000,5,0,0:0:0:0:
`;

await test('parseOsu: metadata, difficulty, timing, colours, objects', () => {
  const bm = parseOsu(OSU);
  assert.equal(bm.mode, 2); assert.equal(bm.title, 'Test Song'); assert.equal(bm.version, 'Test Diff');
  assert.equal(bm.cs, 4); assert.equal(bm.ar, 9); assert.equal(bm.sliderMultiplier, 1.4);
  assert.equal(bm.timingPoints.length, 2);
  assert.equal(bm.timingPoints[0].uninherited, true); assert.equal(bm.timingPoints[1].uninherited, false);
  assert.deepEqual(bm.colours, [[255, 0, 0], [0, 255, 0]]);
  assert.deepEqual(bm.hitObjects.map((h) => h.kind), ['fruit', 'fruit', 'stream', 'shower', 'fruit']);
  assert.equal(bm.hitObjects[2].pixelLength, 200);
  assert.deepEqual(bm.hitObjects[2].points, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
});

await test('parseOsu: AR falls back to OD on old maps', () => {
  assert.equal(parseOsu('[Difficulty]\nCircleSize:5\nOverallDifficulty:7\n').ar, 7);
});

await test('buildScene: difficulty numbers (verified formulas from lazer)', () => {
  const s = buildScene(parseOsu(OSU), 0);
  assert.equal(s.preempt, 600);                  // AR9 -> 1200 - 750*4/5 = 600
  near(s.catcherScale, 1 - 0.7 * (4 - 5) / 5);   // 1.14
  near(s.catchWidth, 106.75 * 1.14 * 0.8);       // 97.356
  near(s.fruitRadius, 64 * 0.57);
  // HR: CS 4*1.3=5.2, AR 9*1.4=12.6 -> capped 10 -> 450
  const hr = buildScene(parseOsu(OSU), 16);
  assert.equal(hr.preempt, 450); near(hr.cs, 5.2);
  // EZ halves
  const ez = buildScene(parseOsu(OSU), 2);
  near(ez.cs, 2); near(ez.ar, 4.5);
});

await test('buildScene: juice stream nested objects match hand calculation', () => {
  const s = buildScene(parseOsu(OSU), 0);
  const fruits = s.objects.filter((o) => o.kind === 'fruit');
  const drops = s.objects.filter((o) => o.kind === 'droplet');
  const tiny = s.objects.filter((o) => o.kind === 'tiny');
  // 2 circles + head + tail of the stream + final circle = 5 fruits; 1 tick; 8 tiny droplets; spinner ignored
  assert.equal(fruits.length, 5);
  assert.equal(drops.length, 1);
  assert.equal(tiny.length, 8);
  // slider: velocity 0.28 px/ms, 200px -> 714.2857 ms
  const head = fruits.find((f) => f.t === 2000);
  const tail = fruits.find((f) => Math.abs(f.t - 2714.2857142857) < 1e-6);
  assert.ok(head && tail);
  near(head.x, 100); near(tail.x, 300);
  // tick every 140px -> at 70% of the span
  near(drops[0].t, 2000 + 0.7 * (200 / 0.28), 1e-6); near(drops[0].x, 240, 1e-6);
  // tiny droplets between head and tick: 500ms gap halved to 62.5ms steps -> 7 of them
  assert.equal(tiny.filter((o) => o.t > 2000 && o.t < drops[0].t).length, 7);
  // sorted by time
  for (let i = 1; i < s.objects.length; i++) assert.ok(s.objects[i].t >= s.objects[i - 1].t);
});

await test('buildScene: slider velocity from green line (x0.5 slows the slider down)', () => {
  const text = OSU.replace('100,100,2000,6,0,L|300:100,1,200', '100,100,4500,6,0,L|300:100,1,200').replace('400,300,5000,5', '400,300,9000,5');
  const s = buildScene(parseOsu(text), 0);
  // at 4500 the -100 line (x1) is active -> same speed
  const tail = s.objects.filter((o) => o.kind === 'fruit' && o.t > 4500 && o.t < 6000);
  near(tail[tail.length - 1].t, 4500 + 200 / 0.28, 1e-6);
  const text2 = text.replace('4000,-100', '4000,-200');
  const s2 = buildScene(parseOsu(text2), 0);
  const tail2 = s2.objects.filter((o) => o.kind === 'fruit' && o.t > 4500 && o.t < 6000);
  near(tail2[tail2.length - 1].t, 4500 + 200 / 0.14, 1e-6);
});

await test('buildScene: combo numbers advance on new combo; a spinner forces one on the next object', () => {
  const s = buildScene(parseOsu(OSU), 0);
  const byT = (t) => s.objects.find((o) => Math.abs(o.t - t) < 1e-6);
  assert.equal(byT(1000).combo, 0);
  assert.equal(byT(1500).combo, 0);
  assert.equal(byT(2000).combo, 1);   // new combo flag on the stream
  assert.equal(byT(5000).combo, 2);   // spinner's own flag must not count twice
  const col = (o) => o.combo % s.colours.length;
  assert.deepEqual([1000, 1500, 2000, 5000].map((t) => col(byT(t))), [0, 0, 1, 0]);
});

await test('buildScene: idx (picks the fruit sprite) is per top-level object; streams share it; showers count', () => {
  const s = buildScene(parseOsu(OSU), 0);
  const byT = (t) => s.objects.find((o) => Math.abs(o.t - t) < 1e-6);
  assert.equal(byT(1000).idx, 0);
  assert.equal(byT(1500).idx, 1);
  assert.ok(s.objects.filter((o) => o.t >= 2000 && o.t < 3000).every((o) => o.idx === 2));
  assert.equal(byT(5000).idx, 4);     // index 3 is the banana shower
});

await test('buildScene: kiai comes from the timing point effects flag', () => {
  const s = buildScene(parseOsu(OSU.replace('4000,-100,4,1,0,100,0,0', '4000,-100,4,1,0,100,0,1')), 0);
  assert.equal(s.objects.find((o) => o.t === 1000).kiai, false);
  assert.equal(s.objects.find((o) => o.t === 5000).kiai, true);
});

await test('resolveColours: beatmap > skin.ini > osu! defaults', () => {
  const withMap = parseOsu(OSU), noMap = parseOsu(OSU.replace(/Combo\d : .*\n/g, ''));
  const skin = { colours: [[1, 2, 3]] };
  assert.deepEqual(resolveColours(withMap, skin), [[255, 0, 0], [0, 255, 0]]);
  assert.deepEqual(resolveColours(noMap, skin), [[1, 2, 3]]);
  assert.deepEqual(resolveColours(noMap, { colours: [] }), DEFAULT_COLOURS);
  assert.deepEqual(resolveColours(noMap, null), DEFAULT_COLOURS);
});

await test('export range: m:ss parsing, clamping to the map, and errors', async () => {
  const { parseClock, resolveRange } = await import('../src/range.js');
  assert.equal(parseClock(''), null); assert.equal(parseClock('  '), null);
  assert.equal(parseClock('1:05'), 65000); assert.equal(parseClock('1:05.5'), 65500); assert.equal(parseClock('65'), 65000); assert.equal(parseClock('0:00'), 0);
  assert.ok(Number.isNaN(parseClock('abc'))); assert.ok(Number.isNaN(parseClock('1:2:3'))); assert.ok(Number.isNaN(parseClock('-5')));
  const sc = { startTime: 2000, endTime: 100000 };
  assert.deepEqual(resolveRange('', '', sc), { from: 2000, to: 100000, whole: true });
  assert.deepEqual(resolveRange('0:10', '0:20', sc), { from: 12000, to: 22000, whole: false });   // times count from the map's first object
  assert.deepEqual(resolveRange('0:10', '', sc), { from: 12000, to: 100000, whole: false });
  assert.deepEqual(resolveRange('', '99:00', sc), { from: 2000, to: 100000, whole: true }, 'an end past the map is clamped');
  assert.ok(resolveRange('0:10', '0:10', sc).error, 'empty range');
  assert.ok(resolveRange('0:20', '0:10', sc).error, 'reversed range');
  assert.ok(resolveRange('x', '', sc).error, 'bad text');
});

await test('ReplayTrack.facingAt follows the last direction moved', () => {
  const tr = new ReplayTrack([{ t: 0, x: 100, dash: false }, { t: 100, x: 200, dash: false }, { t: 200, x: 200, dash: false }, { t: 300, x: 50, dash: false }, { t: 400, x: 50, dash: false }]);
  assert.equal(tr.facingAt(-10), 1);
  assert.equal(tr.facingAt(50), 1);    // moving right
  assert.equal(tr.facingAt(150), 1);   // standing still after moving right
  assert.equal(tr.facingAt(250), -1);  // moving left
  assert.equal(tr.facingAt(350), -1);  // standing still after moving left
  assert.equal(tr.facingAt(999), -1);
});

await test('ReplayTrack interpolates and evaluateCatches uses 0.8 * 106.75 * scale width', () => {
  const track = new ReplayTrack([{ t: 0, x: 0, dash: false }, { t: 1000, x: 200, dash: true }]);
  near(track.xAt(-50), 0); near(track.xAt(500), 100); near(track.xAt(2000), 200);
  assert.equal(track.dashAt(500), false); assert.equal(track.dashAt(1000), true);

  const scene = buildScene(parseOsu(OSU), 0);            // catch width 97.356 -> half 48.678
  const frames = [{ t: 0, x: 100, dash: false }, { t: 6000, x: 100, dash: false }];
  const res = evaluateCatches(scene, new ReplayTrack(frames));
  const o1000 = scene.objects.find((o) => o.t === 1000);   // x=100 -> caught
  const o1500 = scene.objects.find((o) => o.t === 1500);   // x=256 -> missed
  const o5000 = scene.objects.find((o) => o.t === 5000);   // x=400 -> missed
  assert.equal(o1000.caught, true); assert.equal(o1500.caught, false); assert.equal(o5000.caught, false);
  assert.ok(res.caught >= 1 && res.total > res.caught);
  // edge: exactly at half-width
  const edge = new ReplayTrack([{ t: 0, x: 256 - 48.6, dash: false }]);
  evaluateCatches(scene, edge);
  assert.equal(scene.objects.find((o) => o.t === 1500).caught, true);
  const out = new ReplayTrack([{ t: 0, x: 256 - 48.8, dash: false }]);
  evaluateCatches(scene, out);
  assert.equal(scene.objects.find((o) => o.t === 1500).caught, false);
});

// ---------- .osz reader ----------
const { readOsz, findDifficulty, findAudio, findImage } = await import('../src/osz.js');
const OSZ = { findImage };
const { zipSync: zipSyncOsz, strToU8: strToU8Osz } = await import('../vendor/fflate.mjs');

await test('readOsz: finds difficulties + audio, ignores videos/images, matches by md5, audio by name', () => {
  const diffA = strToU8Osz(OSU), diffB = strToU8Osz(OSU.replace('Test Diff', 'Other Diff'));
  const osz = readOsz(zipSyncOsz({
    'Artist - Song (Mapper) [Test Diff].osu': diffA,
    'Artist - Song (Mapper) [Other Diff].osu': diffB,
    'Audio.MP3': new Uint8Array([1, 2, 3, 4]),
    'bg.jpg': new Uint8Array(1000),
    'video.avi': new Uint8Array(1000),
    'sfx/hit.wav': new Uint8Array([9, 9]),
  }));
  assert.equal(osz.difficulties.length, 2);
  assert.deepEqual([...osz.audio.keys()].sort(), ['audio.mp3', 'hit.wav']);
  const wantMd5 = crypto.createHash('md5').update(diffB).digest('hex');
  assert.equal(findDifficulty(osz, wantMd5).name, 'Artist - Song (Mapper) [Other Diff].osu');
  assert.equal(findDifficulty(osz, wantMd5.toUpperCase()).name.includes('Other'), true);
  assert.equal(findDifficulty(osz, 'f'.repeat(32)), null);
  assert.deepEqual(findAudio(osz, 'audio.mp3'), new Uint8Array([1, 2, 3, 4]));
  assert.ok(findAudio(osz, 'AUDIO.mp3') && findAudio(osz, 'sub\\Audio.mp3'));
  assert.equal(findAudio(osz, 'nope.mp3'), null);
  assert.equal(findAudio(osz, ''), null);
  assert.equal(parseOsu(OSU.replace('Mode: 2', 'Mode: 2\nAudioFilename: song.mp3')).audioFilename, 'song.mp3');
});

await test('readOsz: rejects non-zip and sets without difficulties', () => {
  assert.throws(() => readOsz(new Uint8Array([1, 2, 3, 4, 5])), /valid .osz/);
  assert.throws(() => readOsz(zipSyncOsz({ 'audio.mp3': new Uint8Array([1]) })), /No .osu/);
});

// ---------- mirror download (mocked network) ----------
const { fetchSetForReplay, parseSetId, extractSetId, MirrorError, MIRRORS } = await import('../src/mirror.js');

const mirrorDiff = strToU8Osz(OSU);
const mirrorMd5 = crypto.createHash('md5').update(mirrorDiff).digest('hex');
const mirrorOsz = zipSyncOsz({ 'Artist - Song (Me) [Test Diff].osu': mirrorDiff, 'audio.mp3': new Uint8Array([1, 2, 3]) });
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const mkFetch = (routes, log = []) => async (url, init) => {
  log.push(url);
  const hit = routes.find(([m]) => (typeof m === 'string' ? url === m : m.test(url)));
  if (!hit) throw new TypeError('Failed to fetch');
  const v = typeof hit[1] === 'function' ? await hit[1](url, init) : hit[1];
  if (v instanceof Error) throw v;
  return v;
};
const HINAI_LOOKUP = `https://mirror.hinamizawa.ai/v3/osu/beatmaps/md5/${mirrorMd5}`;

await test('parseSetId: ids, links, empty and junk', () => {
  assert.equal(parseSetId('123456'), 123456);
  assert.equal(parseSetId('  987 '), 987);
  assert.equal(parseSetId('https://osu.ppy.sh/beatmapsets/123456#fruits/987'), 123456);
  assert.equal(parseSetId('osu.ppy.sh/s/55'), 55);
  assert.equal(parseSetId(''), null);
  assert.equal(parseSetId(undefined), null);
  for (const bad of ['0', 'abc', 'https://osu.ppy.sh/beatmaps/987', 'https://example.com/beatmapsets/12', '12 34', '-5']) assert.ok(Number.isNaN(parseSetId(bad)), bad);
});

await test('extractSetId: flat, wrapped, nested and array shapes; ignores a bare beatmap id', () => {
  assert.equal(extractSetId({ id: 736215, beatmapset_id: 320118 }), 320118);
  assert.equal(extractSetId({ data: { beatmapset_id: 5 } }), 5);
  assert.equal(extractSetId({ beatmap: { SetID: 7 } }), 7);
  assert.equal(extractSetId({ id: 1, beatmapset: { id: 9 } }), 9);
  assert.equal(extractSetId([{ set_id: 11 }]), 11);
  assert.equal(extractSetId({ id: 736215, version: 'x' }), null);   // `id` alone is the difficulty id, never guessed as a set id
  assert.equal(extractSetId({ beatmapset_id: 'abc' }), null);
  assert.equal(extractSetId(null), null);
  assert.equal(extractSetId('text'), null);
});

await test('fetchSetForReplay: lookup -> download (no-video variant first) -> matched by hash', async () => {
  const log = [];
  const statuses = [], progress = [];
  const res = await fetchSetForReplay({
    md5: mirrorMd5.toUpperCase(),
    fetchImpl: mkFetch([
      [HINAI_LOOKUP, jsonRes({ id: 1, beatmapset_id: 4242 })],
      ['https://mirror.hinamizawa.ai/api/v1/hinai/d/4242n', () => new Response('nope', { status: 404 })],
      ['https://mirror.hinamizawa.ai/api/v1/hinai/d/4242', () => new Response(mirrorOsz, { headers: { 'content-length': String(mirrorOsz.length) } })],
    ], log),
    onStatus: (t) => statuses.push(t), onProgress: (got, total, m) => progress.push([got, total, m]),
  });
  assert.equal(res.setId, 4242); assert.equal(res.mirror, 'mirror.hinamizawa.ai'); assert.equal(res.matched, true);
  assert.equal(res.osz.difficulties.length, 1);
  assert.deepEqual(log, [HINAI_LOOKUP, 'https://mirror.hinamizawa.ai/api/v1/hinai/d/4242n', 'https://mirror.hinamizawa.ai/api/v1/hinai/d/4242']);
  assert.ok(statuses[0].includes('Looking up') && statuses.at(-1).includes('Downloading'));
  assert.deepEqual(progress.at(-1), [mirrorOsz.length, mirrorOsz.length, 'mirror.hinamizawa.ai']);
});

await test('fetchSetForReplay: a typed set id skips the lookup entirely', async () => {
  const log = [];
  const res = await fetchSetForReplay({
    md5: mirrorMd5, setId: 77,
    fetchImpl: mkFetch([['https://mirror.hinamizawa.ai/api/v1/hinai/d/77n', () => new Response(mirrorOsz)]], log),
  });
  assert.equal(res.setId, 77);
  assert.deepEqual(log, ['https://mirror.hinamizawa.ai/api/v1/hinai/d/77n']);
});

await test('fetchSetForReplay: falls through unreachable / HTML / non-zip answers to a mirror that works', async () => {
  const log = [];
  const res = await fetchSetForReplay({
    md5: mirrorMd5,
    fetchImpl: mkFetch([
      // hinai: lookup unreachable (CORS or offline) -> osu.direct has no lookup -> catboy answers
      [`https://catboy.best/api/v2/md5/${mirrorMd5}`, jsonRes({ data: { beatmapset_id: 31 } })],
      ['https://mirror.hinamizawa.ai/api/v1/hinai/d/31n', () => new Response('<html>error</html>', { status: 200 })], // not a zip
      ['https://mirror.hinamizawa.ai/api/v1/hinai/d/31', () => new Response('', { status: 429 })],
      ['https://osu.direct/api/d/31', () => new Response('<html>cloudflare</html>')],                                   // not a zip
      ['https://catboy.best/d/31n', () => new Response(mirrorOsz)],
    ], log),
  });
  assert.equal(res.mirror, 'catboy.best');
  assert.equal(log[0], HINAI_LOOKUP);
  assert.equal(log.filter((u) => u.includes('osu.direct')).length, 1);
});

await test('fetchSetForReplay: set without the exact hash is returned with matched=false', async () => {
  const other = zipSyncOsz({ 'x.osu': strToU8Osz(OSU.replace('Test Diff', 'Changed')) });
  const res = await fetchSetForReplay({ md5: mirrorMd5, setId: 5, fetchImpl: mkFetch([[/d\/5n$/, () => new Response(other)]]) });
  assert.equal(res.matched, false);
});

await test('fetchSetForReplay: every mirror unreachable -> MirrorError listing each one and the CORS hint', async () => {
  await assert.rejects(
    () => fetchSetForReplay({ md5: mirrorMd5, fetchImpl: mkFetch([]) }),
    (e) => e instanceof MirrorError
      && /Could not find this map by its hash/.test(e.message)
      && e.message.includes('mirror.hinamizawa.ai (lookup)') && e.message.includes('catboy.best (lookup)')
      && /do not allow requests from web pages/.test(e.message) && /paste the beatmap set link/.test(e.message)
      && e.attempts.length === 2,
  );
  await assert.rejects(
    () => fetchSetForReplay({ md5: mirrorMd5, setId: 9, fetchImpl: mkFetch([]) }),
    (e) => /Found the map \(set 9\) but could not download it/.test(e.message) && e.attempts.length === MIRRORS.reduce((n, m) => n + m.downloads(9).length, 0),
  );
});

await test('fetchSetForReplay: bad hash, lookup without a set id, HTTP errors', async () => {
  await assert.rejects(() => fetchSetForReplay({ md5: 'xyz', fetchImpl: mkFetch([]) }), /valid beatmap hash/);
  await assert.rejects(
    () => fetchSetForReplay({ md5: mirrorMd5, fetchImpl: mkFetch([[HINAI_LOOKUP, jsonRes({ id: 5 })], [/catboy/, jsonRes({ error: 'x' }, 500)]]) }),
    (e) => /did not contain a beatmap set id/.test(e.message) && /HTTP 500/.test(e.message),
  );
});

await test('fetchSetForReplay: a hanging mirror times out and the next one is used; user cancel aborts', async () => {
  // like a real fetch: rejects when the signal aborts, or immediately if it is already aborted
  const hang = (_u, init) => new Promise((_, rej) => {
    const fail = () => rej(new DOMException('aborted', 'AbortError'));
    if (init.signal.aborted) fail(); else init.signal.addEventListener('abort', fail);
  });
  const res = await fetchSetForReplay({
    md5: mirrorMd5, setId: 3, downloadIdleMs: 40,
    fetchImpl: mkFetch([[/hinamizawa/, hang], ['https://osu.direct/api/d/3', () => new Response(mirrorOsz)]]),
  });
  assert.equal(res.mirror, 'osu.direct');

  const ctl = new AbortController();
  const p = fetchSetForReplay({ md5: mirrorMd5, setId: 3, signal: ctl.signal, fetchImpl: mkFetch([[/.*/, hang]]) });
  setTimeout(() => ctl.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  await assert.rejects(fetchSetForReplay({ md5: mirrorMd5, setId: 3, signal: AbortSignal.abort(), fetchImpl: mkFetch([[/.*/, hang]]) }), (e) => e.name === 'AbortError');
});

await test('fetchSetForReplay: streamed body reports progress; oversized content-length is refused', async () => {
  const half = Math.floor(mirrorOsz.length / 2);
  const stream = new ReadableStream({ start(c) { c.enqueue(mirrorOsz.slice(0, half)); c.enqueue(mirrorOsz.slice(half)); c.close(); } });
  const progress = [];
  const res = await fetchSetForReplay({
    md5: mirrorMd5, setId: 8, onProgress: (g, t) => progress.push([g, t]),
    fetchImpl: mkFetch([[/d\/8n$/, () => new Response(stream, { headers: { 'content-length': String(mirrorOsz.length) } })]]),
  });
  assert.equal(res.bytes.length, mirrorOsz.length);
  assert.deepEqual(progress.map((p) => p[0]), [half, mirrorOsz.length]);

  await assert.rejects(
    () => fetchSetForReplay({ md5: mirrorMd5, setId: 8, mirrors: [MIRRORS[1]], fetchImpl: mkFetch([[/.*/, () => new Response('x', { headers: { 'content-length': String(400 * 1024 * 1024) } })]]) }),
    /file is too large/,
  );
});

// ---------- audio DSP ----------
const { prepareAudio, timeStretch, resample, SAMPLE_RATE: SR } = await import('../src/audio.js');
const sine = (freq, sec, amp = 0.5) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const rms = (a, from = 0, to = a.length) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
const freqOf = (a, from, to) => { let z = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] <= 0 && a[i] > 0) z++; return z / ((to - from) / SR); };
const firstAbove = (a, thr) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > thr) return i; return -1; };
// 1 kHz burst of `ms` milliseconds starting at map time `atMs`, in a silent 3 s track
const burstTrack = (atMs, ms = 100) => { const t = new Float32Array(3 * SR); const b = sine(1000, ms / 1000, 0.8); t.set(b, Math.round((atMs / 1000) * SR)); return [t, t.slice()]; };

await test('prepareAudio rate 1: audio lines up with beatmap time (negative start = silence first)', () => {
  const [l, r] = burstTrack(1000);
  const [oL, oR] = prepareAudio([l, r], { startTime: -100, durationSec: 2 });
  assert.equal(oL.length, 2 * SR); assert.equal(oR.length, 2 * SR);
  const onset = firstAbove(oL, 0.05) / SR;                    // burst at map 1000 ms -> video 1.1 s
  near(onset, 1.1, 0.01);
  assert.equal(firstAbove(oL.subarray(0, Math.round(1.09 * SR)), 1e-6), -1, 'silent before the beep');
  const mid = prepareAudio([l, r], { startTime: 900, durationSec: 0.5 })[0];   // starts mid-song
  near(firstAbove(mid, 0.05) / SR, 0.1, 0.01);
});

await test('prepareAudio: mono input is duplicated, volume applied, past-the-end is silence', () => {
  const mono = sine(440, 1, 1);
  const [a, b] = prepareAudio([mono], { startTime: 0, durationSec: 1.5, volume: 0.5 });
  assert.equal(a.length, 1.5 * SR); assert.deepEqual(a.subarray(1000, 1010), b.subarray(1000, 1010));
  near(rms(a, 4800, 40000), 0.5 * 0.7071, 0.01);
  assert.equal(rms(a, Math.round(1.1 * SR), 1.4 * SR), 0);
});

await test('timeStretch keeps pitch and level (rate 1.5, 0.75) and returns exact length', () => {
  for (const rate of [1.5, 0.75]) {
    const input = sine(440, 4);
    const outLen = Math.round((4 / rate) * SR);
    const [o] = timeStretch([input, input.slice()], rate, outLen);
    assert.equal(o.length, outLen);
    const from = Math.round(0.3 * SR), to = outLen - Math.round(0.3 * SR);
    near(freqOf(o, from, to), 440, 440 * 0.02);
    near(rms(o, from, to), 0.5 * 0.7071, 0.04);
  }
});

await test('timeStretch on a harmonic signal: no big level dips at splice points', () => {
  const n = 4 * SR, input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 660 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / SR);
  const outLen = Math.round((4 / 1.5) * SR);
  const [o] = timeStretch([input, input], 1.5, outLen);
  const win = 480; let min = Infinity, max = 0;                    // 10 ms RMS windows
  for (let s = Math.round(0.2 * SR); s < outLen - Math.round(0.2 * SR); s += win) { const v = rms(o, s, s + win); min = Math.min(min, v); max = Math.max(max, v); }
  assert.ok(min > 0.6 * max, `level dips: min ${min.toFixed(3)} vs max ${max.toFixed(3)}`);
});

await test('nightcore resampling raises pitch by the rate', () => {
  const input = sine(440, 3);
  const [o] = resample([input], 1.5, Math.round((3 / 1.5) * SR));
  near(freqOf(o, 4800, o.length - 4800), 660, 660 * 0.01);
});

await test('prepareAudio DT: the beep lands at (map time - start) / 1.5 and keeps its pitch', () => {
  const [l, r] = burstTrack(1000, 150);
  const [o] = prepareAudio([l, r], { startTime: -100, durationSec: 1.6, rate: 1.5 });
  const onset = firstAbove(o, 0.1) / SR;                           // (1000 + 100) / 1.5 = 733 ms
  near(onset, 0.7333, 0.03);
  const f0 = firstAbove(o, 0.1) + Math.round(0.02 * SR);
  near(freqOf(o, f0, f0 + Math.round(0.05 * SR)), 1000, 60);       // pitch preserved
});

await test('prepareAudio NC: same timing, pitch x1.5', () => {
  const [l, r] = burstTrack(1000, 150);
  const [o] = prepareAudio([l, r], { startTime: -100, durationSec: 1.6, rate: 1.5, nightcore: true });
  near(firstAbove(o, 0.1) / SR, 0.7333, 0.01);
  const f0 = firstAbove(o, 0.1) + Math.round(0.02 * SR);
  near(freqOf(o, f0, f0 + Math.round(0.05 * SR)), 1500, 90);
});

await test('prepareAudio HT: beep later and longer, pitch preserved', () => {
  const [l, r] = burstTrack(1000, 150);
  const [o] = prepareAudio([l, r], { startTime: 0, durationSec: 2, rate: 0.75 });
  near(firstAbove(o, 0.1) / SR, 1.3333, 0.03);                     // 1000 / 0.75
  const f0 = firstAbove(o, 0.1) + Math.round(0.03 * SR);
  near(freqOf(o, f0, f0 + Math.round(0.08 * SR)), 1000, 60);
});

// ---------- skin tests (need a canvas implementation to decode images) ----------
let canvasLib = null;
try { canvasLib = await import('@napi-rs/canvas'); } catch { /* optional */ }

if (!canvasLib) {
  console.log('skip skin + render tests (npm install to enable @napi-rs/canvas)');
} else {
  const env = {
    decode: (bytes) => canvasLib.loadImage(Buffer.from(bytes)),
    createCanvas: (w, h) => canvasLib.createCanvas(w, h),
  };
  const png = (w, h, draw) => {
    const c = canvasLib.createCanvas(w, h);
    draw?.(c.getContext('2d'), w, h);
    return new Uint8Array(c.toBuffer('image/png'));
  };
  const solid = (w, h, colour = '#fff') => png(w, h, (g) => { g.fillStyle = colour; g.fillRect(0, 0, w, h); });
  const bytesOf = async (url) => new Uint8Array(fs.readFileSync(path.join(root, url)));

  await test('parseSkinIni: name, version, combo colours (with comments and odd spacing)', () => {
    const ini = parseSkinIni('﻿[General]\nName: My Skin\nVersion: 2.5\n\n[Colours]\nCombo1 : 10, 20, 30 // red-ish\nCombo3: 1,2,3\nCombo9: 9,9,9\nSliderBorder: 1,1,1\n');
    assert.equal(ini.name, 'My Skin'); assert.equal(ini.version, 2.5);
    assert.deepEqual(ini.colours, [[10, 20, 30], [1, 2, 3]]);
    assert.equal(parseSkinIni('[General]\nVersion: latest').version, 2.7);
  });

  await test('readOsk: only keeps fruit images + skin.ini, case-insensitive, root wins over sub-folder', () => {
    const zip = zipSync({
      'skin.ini': strToU8('[General]\nName: T\n'),
      'Fruit-Pear.PNG': solid(8, 8),
      'sub/fruit-pear.png': solid(4, 4),
      'sub/fruit-grapes.png': solid(8, 8),
      'hitcircle.png': solid(8, 8),
      'readme.txt': strToU8('x'),
    });
    const files = readOsk(zip);
    assert.deepEqual([...files.keys()].sort(), ['fruit-grapes.png', 'fruit-pear.png', 'skin.ini']);
    assert.throws(() => readOsk(new Uint8Array([1, 2, 3, 4])), /valid .osk/);
  });

  await test('Skin: @2x preferred and halved, plain png kept, missing -> null, fallback used', async () => {
    const base = new Skin(new Map([['fruit-apple@2x.png', solid(256, 256)]]), env, { label: 'default' });
    const user = new Skin(new Map([
      ['fruit-pear@2x.png', solid(200, 100)], ['fruit-pear.png', solid(10, 10)],  // both present: @2x wins
      ['fruit-grapes.png', solid(120, 120)],
    ]), env, { label: 'custom', fallback: base });
    await user.preload(['fruit-pear', 'fruit-grapes', 'fruit-apple', 'fruit-orange']);
    const pear = user.get('fruit-pear'); assert.deepEqual([pear.w, pear.h, pear.from], [100, 50, 'custom']);
    const grapes = user.get('FRUIT-GRAPES'); assert.deepEqual([grapes.w, grapes.h], [120, 120]);
    const apple = user.get('fruit-apple'); assert.deepEqual([apple.w, apple.from], [128, 'default']);
    assert.equal(user.get('fruit-orange'), null);
    const d = describeSkin(user);
    assert.ok(d.own.includes('fruit-pear') && d.fallback.includes('fruit-apple'));
  });

  await test('Skin: a broken image counts as missing (falls back) instead of failing the whole skin', async () => {
    const base = new Skin(new Map([['fruit-pear@2x.png', solid(64, 64)]]), env, { label: 'default' });
    const user = new Skin(new Map([['fruit-pear.png', new Uint8Array([1, 2, 3, 4, 5])]]), env, { label: 'custom', fallback: base });
    await user.preload(['fruit-pear']);
    assert.equal(user.get('fruit-pear').from, 'default');
  });

  await test('Skin.tinted multiplies by the combo colour and keeps transparency', async () => {
    const img = png(4, 4, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 4); }); // left half white, right half transparent
    const skin = new Skin(new Map([['fruit-pear.png', img]]), env);
    await skin.preload(['fruit-pear']);
    const tex = skin.get('fruit-pear');
    const c = skin.tinted(tex, [255, 128, 0]);
    const px = (x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    assert.deepEqual(px(0, 0), [255, 128, 0, 255]);
    assert.equal(px(3, 0)[3], 0);
    assert.equal(skin.tinted(tex, [255, 128, 0]), c, 'cached');
    assert.notEqual(skin.tinted(tex, [0, 0, 255]), c);
  });

  await test('bundled default skin: loads all catch images with the expected sizes', async () => {
    const def = await loadDefaultSkin(env, bytesOf);
    const sz = (n) => { const t = def.get(n); return [t.w, t.h]; };
    assert.deepEqual(sz('fruit-pear'), [128, 128]);
    assert.deepEqual(sz('fruit-pear-overlay'), [128, 128]);
    assert.deepEqual(sz('fruit-drop'), [82, 103]);
    assert.deepEqual(sz('fruit-catcher-idle'), [306, 320]);
    for (const n of ['fruit-apple', 'fruit-grapes', 'fruit-orange', 'fruit-bananas', 'fruit-catcher-kiai', 'fruit-catcher-fail']) assert.ok(def.get(n), n);
    assert.equal(def.get('fruit-drop-overlay'), null, 'default skin has no drop overlay');
    // catcher at CS5: 306 * 0.35 = 107.1, matching Catcher.BASE_SIZE (106.75) used for the catch width
    near(306 * 0.35, 106.75, 0.5);
  });

  await test('loadOskSkin layers a user skin over the default one', async () => {
    const def = await loadDefaultSkin(env, bytesOf);
    const osk = zipSync({ 'skin.ini': strToU8('[General]\nName: Mine\n[Colours]\nCombo1: 5,6,7\n'), 'fruit-pear@2x.png': solid(300, 300), 'fruit-catcher-idle.png': solid(200, 210) });
    const skin = await loadOskSkin(osk, env, def);
    assert.equal(skin.ini.name, 'Mine'); assert.deepEqual(skin.colours, [[5, 6, 7]]);
    assert.deepEqual([skin.get('fruit-pear').w, skin.get('fruit-pear').from], [150, 'custom']);
    assert.equal(skin.get('fruit-apple').from, 'default');
    assert.equal(skin.get('fruit-catcher-idle').w, 200);
    assert.equal(skin.get('fruit-catcher-kiai').from, 'default'); // raw lookup falls back to the default skin...
    const { pickCatcherTexture, pickOverlay } = await import('../src/render.js');
    // a custom fruit must not get the default skin's overlay; the default skin's own pair still matches
    assert.equal(pickOverlay(skin, 'pear', skin.get('fruit-pear')), null);
    assert.equal(pickOverlay(def, 'pear', def.get('fruit-pear')).from, 'default');
    const withOv = await loadOskSkin(zipSync({ 'fruit-pear.png': solid(100, 100), 'fruit-pear-overlay.png': solid(100, 100) }), env, def);
    assert.equal(pickOverlay(withOv, 'pear', withOv.get('fruit-pear')).from, 'custom');
    // ...but the catcher keeps the user's own idle image when the skin has no kiai/fail image
    assert.equal(pickCatcherTexture(skin, 'kiai').from, 'custom');
    assert.equal(pickCatcherTexture(skin, 'fail').from, 'custom');
    assert.equal(pickCatcherTexture(def, 'kiai').from, 'default');
    const osk2 = zipSync({ 'fruit-catcher-idle.png': solid(200, 210), 'fruit-catcher-kiai.png': solid(222, 210) });
    const skin2 = await loadOskSkin(osk2, env, def);
    assert.equal(pickCatcherTexture(skin2, 'kiai').w, 222);        // skin's own kiai image is used
    assert.equal(pickCatcherTexture(skin2, 'fail').from, 'custom'); // no fail image -> its own idle
  });

  await test('render: draws sprite frames to PNG (default skin + a tinted custom skin)', async () => {
    const { drawFrame } = await import('../src/render.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const scene = buildScene(parseOsu(OSU.replace('4000,-100,4,1,0,100,0,0', '4000,-100,4,1,0,100,0,1')), 0);
    const frames = [];
    for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: t % 400 < 100 });
    const track = new ReplayTrack(frames);
    evaluateCatches(scene, track);
    const W = 1280, H = 720;
    const cv = canvasLib.createCanvas(W, H);
    const ctx = cv.getContext('2d');
    fs.mkdirSync(path.join(root, 'test/out'), { recursive: true });
    for (const [name, t] of [['early', 1200], ['stream', 2550], ['late', 5200]]) {
      drawFrame(ctx, W, H, scene, track, t, { skin: def, showCatchWidth: name === 'stream' });
      fs.writeFileSync(path.join(root, `test/out/frame-${name}.png`), cv.toBuffer('image/png'));
    }
    // frame must not be blank: compare against the empty playfield
    const empty = canvasLib.createCanvas(W, H);
    drawFrame(empty.getContext('2d'), W, H, scene, new ReplayTrack([{ t: 0, x: 256, dash: false }]), -99999, { skin: null });
    drawFrame(ctx, W, H, scene, track, 2550, { skin: def });
    assert.notEqual(Buffer.compare(cv.toBuffer('image/png'), empty.toBuffer('image/png')), 0);
  });

  await test('render: the HUD draws combo and accuracy only when asked, and the combo pops after a catch', async () => {
    const { drawFrame } = await import('../src/render.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const scene = buildScene(parseOsu(OSU), 0);
    const frames = [];
    for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: false });
    const track = new ReplayTrack(frames);
    evaluateCatches(scene, track);
    const W = 1280, H = 720;
    const cv = canvasLib.createCanvas(W, H);
    const ctx = cv.getContext('2d');
    const shot = (t, showHud) => { drawFrame(ctx, W, H, scene, track, t, { skin: def, showHud }); return cv.toBuffer('image/png'); };
    const tCaught = scene.objects.find((o) => o.caught && o.kind !== 'banana').t;
    assert.notEqual(Buffer.compare(shot(tCaught + 600, true), shot(tCaught + 600, false)), 0, 'HUD changes the picture');
    assert.notEqual(Buffer.compare(shot(tCaught + 20, true), shot(tCaught + 600, true)), 0);
    fs.writeFileSync(path.join(root, 'test/out/frame-hud.png'), shot(tCaught + 120, true));
  });

  await test('render: stable HUD uses the skin\'s own HP bar images, key counter, and a blank combo font', async () => {
    const { drawFrame } = await import('../src/render.js');
    const { buildKeys } = await import('../src/keys.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const mk = (extra) => { const f = new Map([...extra]); return f; };
    const png = (w, h, rgba) => { const c = canvasLib.createCanvas(w, h); const g = c.getContext('2d'); g.fillStyle = rgba; g.fillRect(0, 0, w, h); return new Uint8Array(c.toBuffer('image/png')); };
    const files = mk([
      ['skin.ini', strToU8('[Fonts]\nComboPrefix: invis\n')],
      ['scorebar-bg.png', png(1312, 768, 'rgba(255,0,0,1)')],
      ['scorebar-colour.png', png(200, 20, 'rgba(0,255,0,1)')],
      ['inputoverlay-key.png', png(43, 46, 'rgba(0,0,255,1)')],
      ...['0','1','2','3','4','5','6','7','8','9'].map((d) => [`invis-${d}.png`, png(25, 35, 'rgba(0,0,0,0)')]),
    ]);
    const skin = await loadOskSkin(zipSync(Object.fromEntries([...files].map(([k, v]) => [k, v]))), env, def);
    const scene = buildScene(parseOsu(OSU), 0);
    const frames = [];
    for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: false });
    const track = new ReplayTrack(frames);
    evaluateCatches(scene, track);
    const W = 1280, H = 720, cv = canvasLib.createCanvas(W, H), ctx = cv.getContext('2d');
    const t = scene.objects.find((o) => o.caught && o.kind !== 'banana').t + 600;
    const draw = (sk, keys) => { drawFrame(ctx, W, H, scene, track, t, { skin: sk, showHud: true, style: 'stable', keys }); return cv.toBuffer('image/png'); };
    const keys = buildKeys(frames);
    assert.notEqual(Buffer.compare(draw(skin, keys), draw(def, keys)), 0, 'skin images change the HUD');
    const ov = (sk) => { drawFrame(ctx, W, H, scene, track, t, { skin: sk, showHud: true, style: 'overlay', keys }); return cv.toBuffer('image/png'); };
    assert.notEqual(Buffer.compare(ov(skin), ov(def)), 0, 'CPOL key counter follows the skin\'s inputoverlay-key');
    drawFrame(ctx, W, H, scene, track, t, { skin, showHud: true, style: 'stable', keys });
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    assert.deepEqual(px(Math.round(1200 * H / 768 * 0.5), 300).slice(0, 3).length, 3);
    fs.writeFileSync(path.join(root, 'test/out/frame-stable-skin.png'), draw(skin, keys));
  });

  await test('mods: Hidden fades fruit like CatchModHidden, and the HUDs list the mods', async () => {
    const { hiddenAlpha, drawFrame } = await import('../src/render.js');
    const { modEntries } = await import('../src/mods.js');
    const { loadArgonFonts } = await import('../src/argon.js');
    near(hiddenAlpha(0.7 * 1000, 1000), 1, 1e-9);
    near(hiddenAlpha(0.6 * 1000, 1000), 1, 1e-9);
    near(hiddenAlpha(0.52 * 1000, 1000), 0.5, 1e-9);
    near(hiddenAlpha(0.44 * 1000, 1000), 0, 1e-9);
    near(hiddenAlpha(100, 1000), 0, 1e-9);
    assert.deepEqual(modEntries(8 | 16 | 64).map((e) => e.code), ['HD', 'HR', 'DT']);
    assert.deepEqual(modEntries(8 | 64 | 512).map((e) => e.code), ['HD', 'NC']);
    assert.deepEqual(modEntries(32 | 16384).map((e) => e.code), ['PF']);
    assert.equal(modEntries(0).length, 0);
    const def = await loadDefaultSkin(env, bytesOf);
    const argon = await loadArgonFonts(env, bytesOf);
    const mk = (mods) => { const sc = buildScene(parseOsu(OSU), mods); const frames = []; for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: false }); const tr = new ReplayTrack(frames); evaluateCatches(sc, tr); return [sc, tr]; };
    const W = 1280, H = 720, cv = canvasLib.createCanvas(W, H), ctx = cv.getContext('2d');
    const [nm, trNm] = mk(0), [hd, trHd] = mk(8 | 16);
    const t = nm.objects.find((o) => o.kind !== 'banana').t - nm.preempt * 0.3;   // a fruit is 30% of its fall from the catch
    const shot = (sc, tr, style, hud) => { drawFrame(ctx, W, H, sc, tr, t, { skin: def, argon, showHud: hud, style }); return cv.toBuffer('image/png'); };
    assert.notEqual(Buffer.compare(shot(nm, trNm, 'stable', false), shot(hd, trHd, 'stable', false)), 0, 'Hidden changes the picture');
    for (const style of ['stable', 'argon']) {
      assert.notEqual(Buffer.compare(shot(hd, trHd, style, true), shot(hd, trHd, style, false)), 0);
      fs.writeFileSync(path.join(root, `test/out/frame-mods-${style}.png`), shot(mk(8 | 16 | 64)[0], mk(8 | 16 | 64)[1], style, true));
    }
  });

  await test('mods: Flashlight radius follows combo, breaks and the glide; the frame goes dark away from the catcher', async () => {
    const { flashlightRadius, FL_DEFAULT } = await import('../src/flashlight.js');
    const { drawFrame } = await import('../src/render.js');
    const fake = (combos, breaks = []) => ({ hud: { timeline: combos.map(([t, combo]) => ({ t, combo })) }, breaks });
    near(flashlightRadius(fake([[0, 0]]), 1000), FL_DEFAULT, 1e-9);
    near(flashlightRadius(fake([[0, 0], [1000, 100]]), 60000), FL_DEFAULT * 0.885, 1e-6);
    near(flashlightRadius(fake([[0, 0], [1000, 200]]), 60000), FL_DEFAULT * 0.77, 1e-6);
    // glide: 1.154 * default per second, so 0.5 s after the drop to 0.885 it has moved 0.577 default of the 0.115 gap -> arrived
    const mid = flashlightRadius(fake([[0, 0], [1000, 200]]), 1100);
    assert.ok(mid < FL_DEFAULT && mid > FL_DEFAULT * 0.77, 'still gliding after 100 ms');
    near(flashlightRadius(fake([[0, 0]], [{ start: 1000, end: 2000 }]), 1900), FL_DEFAULT * 1.538, 1e-6 + FL_DEFAULT * 0.01);
    const def = await loadDefaultSkin(env, bytesOf);
    const mk = (mods) => { const sc = buildScene(parseOsu(OSU), mods); const frames = []; for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: false }); const tr = new ReplayTrack(frames); evaluateCatches(sc, tr); return [sc, tr]; };
    const [sc, tr] = mk(1024), [sc0, tr0] = mk(0);
    const W = 1280, H = 720, cv = canvasLib.createCanvas(W, H), ctx = cv.getContext('2d');
    const t = sc.objects[0].t - sc.preempt * 0.3;
    drawFrame(ctx, W, H, sc, tr, t, { skin: def });
    const dark = [...ctx.getImageData(5, 5, 1, 1).data];
    assert.deepEqual(dark.slice(0, 3), [0, 0, 0], 'far corner is black');
    fs.writeFileSync(path.join(root, 'test/out/frame-flashlight.png'), cv.toBuffer('image/png'));
    drawFrame(ctx, W, H, sc0, tr0, t, { skin: def });
    assert.notDeepEqual([...ctx.getImageData(5, 5, 1, 1).data].slice(0, 3), [0, 0, 0], 'no mod: not black');
  });

  await test('storyboard: parses sprites, animations, loops; easings and commands evaluate; the frame draws tinted, additive sprites', async () => {
    const { parseStoryboard, spriteState, Storyboard, EASINGS, assetKey } = await import('../src/storyboard.js');
    const osb = [
      '[Events]', '//Storyboard Layer 0 (Background)',
      'Sprite,Foreground,Centre,"sb\\a.png",320,240',
      ' F,0,1000,2000,0,1',
      ' S,0,1000,2000,0.5,1.5',
      ' C,0,1000,,255,0,0',
      ' P,0,1000,3000,A',
      ' L,3000,3',
      '  F,0,0,100,1,0',
      ' T,HitSound,0,100',
      '  F,0,0,100,1,0',
      'Animation,Overlay,TopLeft,"sb\\f.png",0,0,4,100,LoopOnce',
      ' MX,0,0,1000,0,100',
      'Sprite,Foreground,Centre,"none.png",0,0',
      '',
    ].join('\r\n');
    const data = parseStoryboard([osb]);
    assert.equal(data.sprites.length, 2, 'the command-less sprite is dropped');
    const [a, f] = data.sprites;
    near(a.lifeStart, 1000, 1e-9); near(a.lifeEnd, 3300, 1e-9);
    assert.equal(spriteState(a, 900), null);
    near(spriteState(a, 1500).alpha, 0.5, 1e-9);
    near(spriteState(a, 1500).sx, 1.0, 1e-9);
    assert.deepEqual([spriteState(a, 1500).r, spriteState(a, 1500).g], [255, 0]);
    assert.ok(spriteState(a, 1500).additive && !spriteState(a, 3100).additive, 'parameter A holds from 1000 to 3000 only');
    near(spriteState(a, 3050).alpha, 0.5, 1e-9);                           // loop iteration 1: fade 1 -> 0 over 100 ms
    near(spriteState(a, 3150).alpha, 0.5, 1e-9);                           // iteration 2 restarts
    assert.equal(spriteState(a, 3400), null);
    assert.equal(f.layer, 4);
    assert.deepEqual(Storyboard.neededFiles(data).filter((k) => k.startsWith('sb/f')), ['sb/f0.png', 'sb/f1.png', 'sb/f2.png', 'sb/f3.png']);
    assert.equal(assetKey('SB\\Sub\\X.PNG'), 'sb/sub/x.png');
    for (const [i, e] of EASINGS.entries()) { near(e(0), i === 24 || i === 28 ? 0 : e(0), 1e-9); assert.ok(Number.isFinite(e(0.37)), `easing ${i} finite`); }
    near(EASINGS[0](0.25), 0.25, 1e-9); near(EASINGS[4](0.5), 0.75, 1e-9); near(EASINGS[17](0.5), 0.5, 1e-9); near(EASINGS[33](1), 1, 1e-9);
    // drawing: a red sprite lands where the 640x480 space says
    const img = canvasLib.createCanvas(40, 40); const ig = img.getContext('2d'); ig.fillStyle = '#fff'; ig.fillRect(0, 0, 40, 40);
    const sbd = parseStoryboard(['[Events]\nSprite,Foreground,Centre,"w.png",320,240\n F,0,0,1000,0,1\n C,0,0,,255,0,0\n S,0,0,,2'].map((x) => x));
    const sb = new Storyboard(sbd, new Map([['w.png', img]]), (w, h) => canvasLib.createCanvas(w, h));
    const cv = canvasLib.createCanvas(640, 480), ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480);
    sb.drawUnder(ctx, 640, 480, 500);
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    near(px(320, 240)[0], 127.5, 2); assert.deepEqual(px(320, 240).slice(1, 3), [0, 0]);   // red at half fade
    assert.deepEqual(px(320 + 45, 240).slice(0, 3), [0, 0, 0], 'outside the 80x80 sprite');
    assert.deepEqual(px(320 + 35, 240).slice(1, 3), [0, 0], 'inside it: no green or blue (tinted red)');
  });

  await test('storyboard: header image sizes, decode plan, and the tint cache', async () => {
    const { parseStoryboard, Storyboard, imageSize } = await import('../src/storyboard.js');
    const c = canvasLib.createCanvas(33, 17); c.getContext('2d').fillRect(0, 0, 33, 17);
    assert.deepEqual(imageSize(new Uint8Array(c.toBuffer('image/png'))), { width: 33, height: 17 });
    assert.deepEqual(imageSize(new Uint8Array(c.toBuffer('image/jpeg'))), { width: 33, height: 17 });
    assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
    const data = parseStoryboard(['[Events]\nSprite,Foreground,Centre,"big.png",0,0\n S,0,0,1000,0.1,0.25\nSprite,Foreground,Centre,"full.png",0,0\n F,0,0,1000,0,1']);
    const sizes = new Map([['big.png', { width: 1920, height: 1080 }], ['full.png', { width: 100, height: 100 }]]);
    const plan = Storyboard.decodePlan(data, sizes, { height: 480 });                  // k = 1: drawn at most 0.25 of native
    assert.deepEqual(plan.get('big.png'), { width: 480, height: 270 });
    assert.deepEqual(plan.get('full.png'), { width: 100, height: 100 });
    const tight = Storyboard.decodePlan(data, sizes, { height: 480, budgetBytes: 1 });  // over budget: shrunk, but never below half
    assert.deepEqual(tight.get('big.png'), { width: 240, height: 135 });
    // the tint cache returns the same pre-tinted canvas while the colour stays put
    const img = canvasLib.createCanvas(40, 40); img.getContext('2d').fillRect(0, 0, 40, 40);
    const sb = new Storyboard(parseStoryboard(['[Events]\nSprite,Foreground,Centre,"w.png",320,240\n F,0,0,100000,1\n C,0,0,,255,0,0']), new Map([['w.png', img]]), (w, h) => canvasLib.createCanvas(w, h));
    const a = sb.tints.get(img, 255, 0, 0), b = sb.tints.get(img, 255, 0, 0);
    assert.equal(a, b); assert.equal(sb.tints.entries.size, 1);
    assert.equal(sb.tints.get(img, 255, 255, 255), img, 'white needs no tint');
  });

  await test('storyboard: the occlusion test knows when a sprite covers the whole frame', async () => {
    const { coversFrame } = await import('../src/storyboard.js');
    // 100x100 frame, sprite 200x200 px centred on it: covers; shifted far off: does not; rotated 45 degrees (diagonal 283): still covers
    assert.equal(coversFrame(100, 100, 50, 50, 1, 1, 1, 0, -100, -100, 200, 200), true);
    assert.equal(coversFrame(100, 100, 350, 50, 1, 1, 1, 0, -100, -100, 200, 200), false);
    const c = Math.SQRT1_2;
    assert.equal(coversFrame(100, 100, 50, 50, 1, 1, c, c, -100, -100, 200, 200), true);
    assert.equal(coversFrame(100, 100, 50, 50, 0.4, 0.4, c, c, -100, -100, 200, 200), false, 'scaled down to 80 px: no longer covers');
    assert.equal(coversFrame(100, 100, 50, 50, -1, 1, 1, 0, -100, -100, 200, 200), true, 'a flip changes nothing for a centred sprite');
  });

  await test('storyboard: replaces the still background image entirely', async () => {
    const { drawFrame } = await import('../src/render.js');
    const { parseStoryboard, Storyboard } = await import('../src/storyboard.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const sc = buildScene(parseOsu(OSU), 0); const frames = []; for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 200, dash: false });
    const tr = new ReplayTrack(frames); evaluateCatches(sc, tr);
    const white = canvasLib.createCanvas(64, 64); { const g = white.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); }
    const sb = new Storyboard(parseStoryboard(['[Events]\nSprite,Foreground,Centre,"x.png",320,240\n F,0,0,100000,0,1']), new Map(), (w, h) => canvasLib.createCanvas(w, h));
    const cv = canvasLib.createCanvas(640, 360), ctx = cv.getContext('2d');
    const corner = () => [...ctx.getImageData(5, 5, 1, 1).data].slice(0, 3);
    drawFrame(ctx, 640, 360, sc, tr, 1000, { skin: def, bg: white, bgDim: 0 });
    assert.deepEqual(corner(), [255, 255, 255], 'without a storyboard the picture shows');
    drawFrame(ctx, 640, 360, sc, tr, 1000, { skin: def, bg: white, bgDim: 0, sb });
    assert.ok(corner()[0] < 40, 'with a storyboard the still picture is gone');
  });

  await test('render: the osu!lazer (Argon) HUD draws its digits, health bar, pp and combo, and reacts to a miss', async () => {
    const { drawFrame } = await import('../src/render.js');
    const { loadArgonFonts } = await import('../src/argon.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const argon = await loadArgonFonts(env, bytesOf);
    assert.equal(argon.img.size, 14, 'all digit images load');
    const scene = buildScene(parseOsu(OSU), 0);
    const frames = [];
    for (let t = 0; t <= 6000; t += 50) frames.push({ t, x: 100 + 150 * Math.sin(t / 700), dash: false });
    const track = new ReplayTrack(frames);
    evaluateCatches(scene, track);
    const W = 1280, H = 720;
    const cv = canvasLib.createCanvas(W, H);
    const ctx = cv.getContext('2d');
    const shot = (t, style, showHud = true) => { drawFrame(ctx, W, H, scene, track, t, { skin: def, argon, showHud, style }); return cv.toBuffer('image/png'); };
    const t = scene.objects.find((o) => o.caught && o.kind !== 'banana').t + 600;
    assert.notEqual(Buffer.compare(shot(t, 'argon'), shot(t, 'argon', false)), 0, 'the Argon HUD changes the picture');
    assert.notEqual(Buffer.compare(shot(t, 'argon'), shot(t, 'overlay')), 0, 'and differs from the clean overlay');
    assert.notEqual(Buffer.compare(shot(t, 'stable'), shot(t, 'overlay')), 0, 'the osu!stable HUD differs from the clean overlay');
    assert.notEqual(Buffer.compare(shot(t, 'stable'), shot(t, 'argon')), 0, 'and from the lazer HUD');
    drawFrame(ctx, W, H, scene, track, t, { skin: def, showHud: true, style: 'argon' });   // images not loaded yet: must not throw
    fs.writeFileSync(path.join(root, 'test/out/frame-argon.png'), shot(t, 'argon'));
  });

  await test('render: hyper glow, hyperdash catcher + trails and bananas change the picture', async () => {
    const { drawFrame } = await import('../src/render.js');
    const def = await loadDefaultSkin(env, bytesOf);
    const osu = OSU.replace(/\[HitObjects\][\s\S]*$/, '[HitObjects]\n20,300,1000,5,0,0:0:0:0:\n490,300,1150,1,0,0:0:0:0:\n490,300,2000,1,0,0:0:0:0:\n256,192,2500,12,0,3500\n300,300,4500,5,0,0:0:0:0:\n');
    const scene = buildScene(parseOsu(osu), 0);
    const frames = [{ t: 0, x: 20, dash: false }, { t: 1000, x: 20, dash: true }, { t: 1140, x: 490, dash: true }, { t: 2200, x: 490, dash: false }, { t: 2500, x: 300, dash: true }, { t: 6000, x: 300, dash: false }];
    const track = new ReplayTrack(frames);
    const res = evaluateCatches(scene, track);
    assert.ok(scene.objects[0].hyper === scene.objects[1], 'first fruit is a hyper');
    assert.ok(scene.fx.segments.length >= 1 && res.bananas > 0);
    const W = 1280, H = 720;
    const cv = canvasLib.createCanvas(W, H);
    const ctx = cv.getContext('2d');
    const png = (t, skin = def) => { drawFrame(ctx, W, H, scene, track, t, { skin }); return cv.toBuffer('image/png'); };
    for (const [name, t] of [['hyper-glow', 600], ['hyper-dash', 1120], ['bananas', 2900]]) fs.writeFileSync(path.join(root, `test/out/frame-${name}.png`), png(t));
    assert.notEqual(Buffer.compare(png(1120), png(500)), 0);
    // trails and tint really appear: same instant without fx differs
    const withFx = png(1120);
    const fx = scene.fx; scene.fx = null;
    const noFx = png(1120);
    scene.fx = fx;
    assert.notEqual(Buffer.compare(withFx, noFx), 0);
  });
}


// ---------- bananas, position offsets, hyperdash ----------
const { LegacyRandom, statelessULong, statelessInt, statelessSingle } = await import('../src/rng.js');
const { computeHyperSegments, hyperAmount, isHyperDashing, catcherStateAt } = await import('../src/catcher.js');

await test('rng: LegacyRandom / StatelessRNG match an independent Python implementation', () => {
  // expected values produced by test/rng_ref.py (written from the lazer C# source)
  const r = new LegacyRandom(1337);
  assert.deepEqual([0, 1, 2, 3, 4].map(() => r.next()), [274941776, 514112300, 938046240, 1928063929, 2025352051]);
  const d = new LegacyRandom(1337);
  assert.deepEqual([0, 1, 2].map(() => d.nextDouble()), [0.1280297413468361, 0.23940219543874264, 0.43681181967258453]);
  const g = new LegacyRandom(1337);
  assert.deepEqual([...Array(8)].map(() => g.nextRange(-20, 20)), [-14, -10, -2, 15, 17, 1, 0, -14]);
  const b = new LegacyRandom(1337);
  assert.deepEqual([...Array(5)].map(() => b.nextBool()), [false, false, false, false, true]);
  assert.equal(typeof statelessULong(1000, 1), 'bigint');
  for (const [seed, series] of [[0, 0], [1000, 1], [98765, 3]]) {
    assert.ok(statelessSingle(seed, series) >= 0 && statelessSingle(seed, series) < 1);
    assert.ok([0, 1, 2].includes(statelessInt(3, seed, series)));
  }
});

const showerMap = (objs) => OSU.replace(/\[HitObjects\][\s\S]*$/, `[HitObjects]\n${objs}\n`);

await test('banana shower: float32 spacing loop, count, times, positions, colours', () => {
  // 2000 ms -> spacing halves 2000,1000,500,250,125,62.5 -> 33 bananas from 1000 to 3000 inclusive
  const bm = parseOsu(showerMap('256,100,500,1,0,0:0:0:0:\n256,192,1000,12,0,3000\n256,300,4000,1,0,0:0:0:0:'));
  const sc = buildScene(bm, 0);
  const ban = sc.objects.filter((o) => o.kind === 'banana');
  assert.equal(ban.length, 33);
  near(ban[0].t, 1000); near(ban[1].t, 1062.5); near(ban[32].t, 3000);
  const rng = new LegacyRandom(1337);
  ban.forEach((b, i) => {
    near(b.x, Math.fround(rng.nextDouble() * 512), 1e-6);   // x is the i-th draw group
    rng.next(); rng.next(); rng.next();
    assert.ok(b.x >= 0 && b.x <= 512);
    assert.deepEqual(b.rgb, [[255, 240, 0], [255, 192, 0], [214, 221, 28]][statelessInt(3, Math.trunc(b.t))]);
    near(b.startScale, 0.6 + 1.6 * statelessSingle(Math.trunc(b.t), 3), 1e-9);
    assert.ok(Math.abs(b.startAngle) <= 180 && Math.abs(b.endAngle) <= 180);
  });
  assert.ok(new Set(ban.map((b) => b.rgb.join())).size > 1, 'colours vary');
  // the fruit after the shower is on a new combo and the shower itself carries no combo
  const fruit = sc.objects.find((o) => o.kind === 'fruit' && o.t === 4000);
  assert.equal(fruit.combo, 1);
  assert.equal(sc.objects.find((o) => o.t === 500).combo, 0);
  assert.equal(ban.filter((b) => b.t < 4000).length, 33);
});

await test('banana shower shorter than 100 ms spacing and degenerate durations', () => {
  const sc = buildScene(parseOsu(showerMap('256,192,1000,12,0,1060')), 0);
  assert.deepEqual(sc.objects.map((o) => o.t), [1000, 1060]);   // spacing 60: 1000, 1060
  assert.equal(buildScene(parseOsu(showerMap('256,192,1000,12,0,1000\n10,10,2000,1,0,0:0:0:0:')), 0).objects.filter((o) => o.kind === 'banana').length, 0);
});

await test('banana evaluation: counted separately, a missed banana does not change the catcher state', () => {
  const bm = parseOsu(showerMap('256,192,1000,12,0,1500\n256,300,2500,1,0,0:0:0:0:'));
  const sc = buildScene(bm, 0);
  const track = new ReplayTrack([{ t: 0, x: 0, dash: false }, { t: 5000, x: 0, dash: false }]);   // stays at the far left
  const res = evaluateCatches(sc, track);
  assert.equal(res.total, 1); assert.equal(res.caught, 0);
  assert.ok(res.bananas > 0 && res.bananasCaught < res.bananas);
  // right after a missed banana (before the missing fruit at 2500) the state is still idle
  const lastBanana = sc.objects.filter((o) => o.kind === 'banana' && !o.caught).pop();
  assert.equal(catcherStateAt(sc.fx, lastBanana.t + 1), 'idle');
  assert.equal(catcherStateAt(sc.fx, 2501), 'fail');
});

await test('tiny droplets get the +-20 offsets from LegacyRandom(1337), in nested order', () => {
  const bm = parseOsu(showerMap('100,100,2000,6,0,L|300:100,1,200'));
  const sc = buildScene(bm, 0);
  const tiny = sc.objects.filter((o) => o.kind === 'tiny');
  const droplets = sc.objects.filter((o) => o.kind === 'droplet');
  assert.ok(tiny.length > 0 && droplets.length > 0);
  // replay the draw order by hand: nested objects sorted by time; droplets draw Next(), tiny draw Next(-20,20)
  const nested = sc.objects.slice();
  const rng = new LegacyRandom(1337);
  for (const o of nested) {
    if (o.kind === 'droplet') rng.next();
    else if (o.kind === 'tiny') {
      const base = 100 + (200 * (o.t - 2000)) / sc.objects[sc.objects.length - 1].t * 0; // not used: compare to a no-offset build below
      void base;
      o._off = rng.nextRange(-20, 20);
    }
  }
  assert.ok(tiny.every((o) => Math.abs(o._off) <= 20));
  // the unjittered x of a tiny droplet lies on the path; with the offset it differs by exactly _off (when not clamped)
  const t0 = tiny[0];
  const x0 = 100 + 200 * ((t0.t - 2000) / (sc.objects.find((o) => o.kind === 'fruit' && o.t > 2000).t - 2000));
  near(t0.x, Math.min(512, Math.max(0, x0 + t0._off)), 0.01);
});

await test('Hard Rock offsets: deterministic, only on fruit, within 20 px and the playfield', () => {
  const objs = ['100,100,1000,1,0,0:0:0:0:', '100,100,1100,1,0,0:0:0:0:', '100,100,1200,1,0,0:0:0:0:', '102,100,1300,1,0,0:0:0:0:', '400,100,1400,1,0,0:0:0:0:'].join('\n');
  const bm = parseOsu(showerMap(objs));
  const normal = buildScene(bm, 0).objects.map((o) => o.x);
  const hr = buildScene(bm, 16).objects.map((o) => o.x);
  assert.deepEqual(normal, [100, 100, 100, 102, 400]);
  assert.notDeepEqual(hr, normal);
  assert.equal(hr[0], 100);                       // first fruit is never moved
  assert.ok(hr.every((x, i) => x >= 0 && x <= 512 && Math.abs(x - normal[i]) <= 20 + 1e-9));
  assert.deepEqual(buildScene(bm, 16).objects.map((o) => o.x), hr);   // same every time
  // reference: replicate lazer's algorithm independently for the first repeated-position fruit
  const rng = new LegacyRandom(1337);
  const right = rng.nextBool();
  const rand = Math.min(20, rng.nextRange(0, 100 / 4));
  const expected = right ? (100 + rand <= 512 ? 100 + rand : 100 - rand) : (100 - rand >= 0 ? 100 - rand : 100 + rand);
  near(hr[1], expected);
});

await test('hyperdash detection: far apart quick fruits are hyper, with the excess carried over', () => {
  // 0 -> 512 in 100 ms is impossible for a catcher; a slow gap is fine
  const objs = ['0,100,1000,1,0,0:0:0:0:', '512,100,1100,1,0,0:0:0:0:', '512,100,3000,1,0,0:0:0:0:', '300,100,3200,1,0,0:0:0:0:'].join('\n');
  const sc = buildScene(parseOsu(showerMap(objs)), 0);
  const [a, b, c, d] = sc.objects;
  assert.ok(a.hyper === b, 'first fruit hypers to the second');
  assert.ok(!b.hyper, 'same position, long gap');
  // third -> fourth: 212 px in 200 ms, minus half a catcher, is within reach only if time allows: compute by hand
  const half = (106.75 * sc.catcherScale) / 2;
  const dist = 212 - half;                          // lastDirection differs (2nd->3rd is "left" by convention) => full half-width
  const timeToNext = 200 - 1000 / 60 / 4;
  assert.equal(!!c.hyper, timeToNext - dist < 0);
  assert.ok(d.hyper === undefined || d.hyper === null || d.hyper === false);
});

await test('hyperdash detection ignores tiny droplets and bananas', () => {
  const sc = buildScene(parseOsu(showerMap('100,100,2000,6,0,L|300:100,1,200\n256,192,4000,12,0,4500')), 0);
  for (const o of sc.objects) if (o.kind === 'tiny' || o.kind === 'banana') assert.ok(!o.hyper);
});

await test('hyperdash timeline: starts on catching a hyper fruit, ends at the next judged object or when the target is passed', () => {
  const objs = [
    { t: 1000, x: 0, kind: 'fruit', caught: true, hyper: null },
    { t: 1100, x: 500, kind: 'fruit', caught: true, hyper: null },
    { t: 1600, x: 500, kind: 'fruit', caught: true, hyper: null },
  ];
  objs[0].hyper = objs[1];
  // catcher runs 0 -> 500 between 1000 and 1100 then waits: the target is passed only if x overshoots (it does not), so it ends at 1100
  const track = new ReplayTrack([{ t: 900, x: 0, dash: true }, { t: 1000, x: 0, dash: true }, { t: 1100, x: 500, dash: true }, { t: 2000, x: 500, dash: false }]);
  const segs = computeHyperSegments(objs, track);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].start, 1000);
  assert.equal(segs[0].end, 1100);
  // a replay that overshoots the target ends the hyperdash early
  const over = new ReplayTrack([{ t: 1000, x: 0, dash: true }, { t: 1050, x: 520, dash: true }, { t: 2000, x: 520, dash: false }]);
  const s2 = computeHyperSegments(objs, over);
  assert.ok(s2[0].end < 1100 && s2[0].end > 1000);
  // a missed hyper fruit does not start a hyperdash
  const missed = objs.map((o) => ({ ...o })); missed[0].caught = false; missed[0].hyper = missed[1];
  assert.equal(computeHyperSegments(missed, track).length, 0);
  // a catcher that is already moving slower than dash speed to the target is not hyper-dashing
  const slow = objs.map((o) => ({ ...o })); slow[0].hyper = { t: 3000, x: 100 };
  assert.equal(computeHyperSegments(slow, track).length, 0);
  // tint: ramps up after the start, ramps down after the end
  const fx = { segments: segs, transitions: [] };
  const sceneLike = { objects: objs, startTime: 0, endTime: 2000, catchWidth: 100 };
  void sceneLike;
});

await test('hyper tint amount and state lookups follow the segments', async () => {
  const { buildCatcherFx } = await import('../src/catcher.js');
  const objs = [
    { t: 1000, x: 0, kind: 'fruit', caught: true, kiai: false },
    { t: 1100, x: 500, kind: 'fruit', caught: true, kiai: true },
  ];
  objs[0].hyper = objs[1];
  const track = new ReplayTrack([{ t: 0, x: 0, dash: true }, { t: 1000, x: 0, dash: true }, { t: 1100, x: 500, dash: true }, { t: 3000, x: 500, dash: false }]);
  const fx = buildCatcherFx({ objects: objs, startTime: 500, endTime: 3000 }, track);
  assert.equal(hyperAmount(fx, 900), 0);
  near(hyperAmount(fx, 1000), 0, 1e-9);
  assert.ok(hyperAmount(fx, 1090) > 0.9);
  assert.ok(isHyperDashing(fx, 1050) && !isHyperDashing(fx, 1100));
  assert.ok(hyperAmount(fx, 1400) < 0.05);
  assert.equal(catcherStateAt(fx, 1050), 'idle');
  assert.equal(catcherStateAt(fx, 1200), 'kiai');
  assert.ok(fx.trails.some((e) => e.kind === 'after'), 'after-image at the start');
  assert.ok(fx.trails.some((e) => e.kind === 'hyper') && fx.trails.some((e) => e.kind === 'dash'));
});

await test('parseSkinIni: hyper colours under [CatchTheBeat] (as real skins have them), commented lines, after-image alpha', () => {
  const ini = parseSkinIni("[CatchTheBeat]\nHyperDash: 255,255,255\nHyperDashAfterImage: 0,0,0,0\n//HyperDashFruit: 255,0,0\nHyperDashFruit: 204,76,255 // purple\n");
  assert.deepEqual([ini.hyperDash, ini.hyperDashFruit, ini.hyperDashAfterImage, ini.hyperDashAfterImageAlpha], [[255, 255, 255], [204, 76, 255], [0, 0, 0], 0]);
  assert.equal(parseSkinIni('[Colours]\nHyperDashAfterImage: 1,2,3\n').hyperDashAfterImageAlpha, 1);
});

await test('parseSkinIni: HyperDash / HyperDashFruit / HyperDashAfterImage, with fallbacks to red / HyperDash', () => {
  const full = parseSkinIni('[Colours]\nHyperDash: 10,20,30\nHyperDashFruit: 40,50,60\nHyperDashAfterImage : 70,80,90\n');
  assert.deepEqual([full.hyperDash, full.hyperDashFruit, full.hyperDashAfterImage], [[10, 20, 30], [40, 50, 60], [70, 80, 90]]);
  const env = { decode: async () => null, createCanvas: () => null };
  assert.deepEqual(new Skin(new Map(), env).hyperColours, { dash: [255, 0, 0], fruit: [255, 0, 0], afterImage: [255, 0, 0], afterImageAlpha: 1 });
  const only = new Skin(new Map([['skin.ini', strToU8('[Colours]\nHyperDash: 1,2,3\n')]]), env).hyperColours;
  assert.deepEqual(only, { dash: [1, 2, 3], fruit: [1, 2, 3], afterImage: [1, 2, 3], afterImageAlpha: 1 });
});


// ---------- hitsounds ----------
const HS = await import('../src/hitsounds.js');

const hsMap = (timing, objs, general = '') => `osu file format v14\n\n[General]\nMode: 2\n${general}\n[Metadata]\nTitle:T\n\n[Difficulty]\nCircleSize:4\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n${timing}\n\n[HitObjects]\n${objs}\n`;
const names = (list) => list.map((x) => `${x.bank}-${x.name}${x.index >= 2 ? x.index : ''}@${x.volume}`);

await test('osu parser: timing point sample fields, [General] defaults, hit object sample fields', () => {
  const bm = parseOsu(hsMap('0,500,4,2,3,60,1,0\n1000,-100,4,3,0,80,0,1', '100,100,1000,1,2,3:2:0:55:\n256,192,2000,12,0,3000,1:0:0:0:', 'SampleSet: Drum\nSampleVolume: 90\n'));
  assert.equal(bm.sampleSet, 3); assert.equal(bm.sampleVolume, 90);
  assert.deepEqual(bm.timingPoints.map((t) => [t.sampleSet, t.sampleIndex, t.volume]), [[2, 3, 60], [3, 0, 80]]);
  assert.equal(bm.hitObjects[0].hitSound, 2); assert.equal(bm.hitObjects[0].sampleStr, '3:2:0:55:');
  assert.equal(bm.hitObjects[1].sampleStr, '1:0:0:0:');
  const bare = parseOsu(hsMap('0,500', '10,10,100,1,0', 'SampleSet: Soft\n'));
  assert.deepEqual([bare.timingPoints[0].sampleSet, bare.timingPoints[0].volume], [2, 100]);
});

await test('sampler: bank 0 follows the timing point, volume 0 inherits, additions use the addition bank', () => {
  const bm = parseOsu(hsMap('0,500,4,2,1,60,1,0\n3000,500,4,3,2,80,1,0',
    '100,100,1000,1,0,0:0:0:0:\n100,100,1500,1,2,0:0:0:0:\n100,100,2000,1,14,1:3:0:90:\n100,100,3500,1,0,0:0:0:0:'));
  const sm = HS.makeSampler(bm);
  const [a, b, c, d] = bm.hitObjects.map((h) => sm.circle(h));
  assert.deepEqual(names(a), ['soft-hitnormal@60']);
  assert.deepEqual(names(b), ['soft-hitnormal@60', 'soft-hitwhistle@60']);
  assert.deepEqual(names(c), ['normal-hitnormal@90', 'drum-hitfinish@90', 'drum-hitwhistle@90', 'drum-hitclap@90']);
  assert.deepEqual(names(d), ['drum-hitnormal2@80']);                  // second timing point: drum, index 2, volume 80
  assert.equal(a[0].index, 1);                                           // inherited from the first timing point
  // a hit sound type without the normal bit still plays the normal sample (layered)
  assert.equal(b[0].name, 'hitnormal');
});

await test('sampler: the timing point at time + 5 ms decides (a point exactly 5 ms after the hit applies)', () => {
  const bm = parseOsu(hsMap('0,500,4,1,0,50,1,0\n1005,500,4,2,0,70,1,0', '100,100,1000,1,0,0:0:0:0:\n100,100,999,1,0,0:0:0:0:'));
  const sm = HS.makeSampler(bm);
  const o = [...bm.hitObjects].sort((x, y) => x.time - y.time);
  assert.deepEqual(names(sm.circle(o[0])), ['normal-hitnormal@50']);
  assert.deepEqual(names(sm.circle(o[1])), ['soft-hitnormal@70']);
});

await test('sampler: juice stream edge sounds / edge sets per node, droplets play slidertick of the body samples', () => {
  const bm = parseOsu(hsMap('0,500,4,1,0,100,1,0',
    '100,100,1000,6,2,L|300:100,2,200,2|0|4,1:0|2:3|3:0,2:0:0:0:'));
  const st = HS.makeSampler(bm).stream(bm.hitObjects[0], 400);
  assert.equal(st.nodes.length, 3);
  assert.deepEqual(names(st.nodes[0]), ['normal-hitnormal@100', 'normal-hitwhistle@100']);
  assert.deepEqual(names(st.nodes[1]), ['soft-hitnormal@100']);          // edge 1: sounds 0 -> normal only, bank soft
  assert.deepEqual(names(st.nodes[2]), ['drum-hitnormal@100', 'drum-hitfinish@100']);
  // body: hitSound 2 with banks from the object's hitSample (soft)
  assert.deepEqual(names(st.body), ['soft-hitnormal@100', 'soft-hitwhistle@100']);
  assert.deepEqual(names(st.droplets), ['soft-slidertick@100', 'soft-slidertick@100']);
});

await test('buildScene attaches samples: fruit, stream nodes, droplets, no sound for tiny droplets, bananas', () => {
  const bm = parseOsu(hsMap('0,500,4,1,1,100,1,0\n0,-100,4,1,1,100,0,0',
    '100,100,1000,1,0,0:0:0:0:\n100,100,2000,6,0,L|300:100,1,200\n256,192,4000,12,0,4400'));
  const sc = buildScene(bm, 0);
  const by = (k) => sc.objects.filter((o) => o.kind === k);
  assert.ok(by('fruit').every((o) => o.samples.length >= 1 && o.samples[0].name === 'hitnormal'));
  assert.ok(by('droplet').length > 0 && by('droplet').every((o) => o.samples.every((x) => x.name === 'slidertick')));
  assert.ok(by('tiny').length > 0 && by('tiny').every((o) => o.samples.length === 0));
  const ban = by('banana');
  assert.ok(ban.length > 3);
  assert.deepEqual(ban.map((o) => o.samples[0].banana), ban.map((_, i) => i));
  assert.ok(ban.every((o) => o.samples[0].volume === 100));
  const stream = by('fruit').filter((o) => o.t >= 2000 && o.t < 3000);
  assert.equal(stream.length, 2);                                       // head + tail nodes
});

await test('findSampleFile: beatmap first only for custom index >= 1, then skin, then default; indexed names; extensions', () => {
  const f = (...n) => new Map(n.map((k) => [k, new Uint8Array([1])]));
  const src = [
    { label: 'beatmap', layer: 'beatmap', files: f('normal-hitnormal.wav', 'soft-hitclap2.ogg') },
    { label: 'skin', layer: 'skin', files: f('normal-hitnormal.mp3', 'drum-hitnormal.wav') },
    { label: 'default', layer: 'default', files: f('normal-hitnormal.wav', 'normal-hitclap.wav', 'soft-hitnormal.wav') },
  ];
  const s = (bank, name, index, extra = {}) => ({ bank, name, index, volume: 100, file: null, ...extra });
  assert.equal(HS.findSampleFile(s('normal', 'hitnormal', 1), src).label, 'beatmap');
  assert.equal(HS.findSampleFile(s('normal', 'hitnormal', 0), src).file, 'normal-hitnormal.mp3');          // index 0: beatmap skipped, skin wins
  assert.equal(HS.findSampleFile(s('soft', 'hitclap', 2), src).file, 'soft-hitclap2.ogg');
  assert.equal(HS.findSampleFile(s('soft', 'hitclap', 3), src), null);                                       // soft-hitclap3 / soft-hitclap / hitclap nowhere
  assert.equal(HS.findSampleFile(s('soft', 'hitnormal', 2), src).label, 'default');                          // falls back to the unindexed default
  assert.equal(HS.findSampleFile(s('normal', 'hitnormal', 1, { file: 'custom.wav' }), [{ label: 'beatmap', layer: 'beatmap', files: f('custom.wav') }]).file, 'custom.wav');
  assert.equal(HS.findSampleFile({ ...s('normal', 'hitnormal', 1), banana: 0 }, [{ label: 'x', layer: 'default', files: f('catch-banana.wav') }]).file, 'catch-banana.wav');
});

const impulse = (n = 100, sr = 48000) => ({ channels: [Float32Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)), Float32Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0))], sampleRate: sr });
const peak = (ch) => { let k = 0; for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > Math.abs(ch[k])) k = i; return k; };

await test('mixHitsounds: placed at (t - start) / rate, rate shortens + pitches, pan, gain, clipping', () => {
  const SR = 48000;
  const mk = () => [new Float32Array(SR * 4), new Float32Array(SR * 4)];
  let out = mk();
  HS.mixHitsounds(out, [{ t: 2000, x: 256, buf: impulse(), gain: 0.5, freq: 1 }], { startTime: 1000, rate: 1, sampleRate: SR });
  assert.equal(peak(out[0]), SR); near(out[0][SR], 0.5); near(out[1][SR], 0.5);
  out = mk();                                           // DT: 1000 ms of beatmap time = 666.67 ms of video
  HS.mixHitsounds(out, [{ t: 2000, x: 256, buf: impulse(), gain: 1, freq: 1 }], { startTime: 1000, rate: 1.5, sampleRate: SR });
  assert.equal(peak(out[0]), Math.round(SR / 1.5));
  // a 100 Hz-ish tone: playing it at 1.5x shortens it to two thirds
  const tone = { channels: [Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 10)), Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 10))], sampleRate: SR };
  const dur = (rate) => { const o = mk(); HS.mixHitsounds(o, [{ t: 0, x: 256, buf: tone, gain: 1, freq: 1 }], { startTime: 0, rate, sampleRate: SR }); let last = 0; for (let i = 0; i < o[0].length; i++) if (Math.abs(o[0][i]) > 1e-4) last = i; return last; };
  near(dur(1.5) / dur(1), 1 / 1.5, 0.01);
  near(dur(0.75) / dur(1), 1 / 0.75, 0.01);
  out = mk();                                           // far right: left channel attenuated by 0.2
  HS.mixHitsounds(out, [{ t: 0, x: 512, buf: impulse(), gain: 1, freq: 1 }], { startTime: 0, rate: 1, sampleRate: SR });
  near(out[0][0], 0.8, 0.011); near(out[1][0], 1);
  assert.equal(HS.balanceFor(256), 0); assert.equal(HS.balanceFor(0), -0.2);
  out = mk();                                           // samples before the video start are skipped, overlapping ones clip at 1
  HS.mixHitsounds(out, [{ t: -5000, x: 256, buf: impulse(), gain: 1, freq: 1 }, { t: 0, x: 256, buf: impulse(), gain: 1, freq: 1 }, { t: 0, x: 256, buf: impulse(), gain: 1, freq: 1 }], { startTime: 0, rate: 1, sampleRate: SR });
  assert.equal(out[0][0], 1);
  out = mk();                                           // banana pitch: frequency 0.77 -> longer sample
  HS.mixHitsounds(out, [{ t: 0, x: 256, buf: tone, gain: 1, freq: 0.77 }], { startTime: 0, rate: 1, sampleRate: SR });
  let last = 0; for (let i = 0; i < out[0].length; i++) if (Math.abs(out[0][i]) > 1e-4) last = i;
  near(last / dur(1), 1 / 0.77, 0.01);
});

// minimal PCM16 WAV reader so the bundled samples can be mixed in Node
const decodeWav = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(p, p + 4)), size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    if (id === 'data') data = { at: p + 8, size };
    p += 8 + size + (size & 1);
  }
  assert.equal(fmt.bits, 16);
  const n = data.size / 2 / fmt.ch;
  const channels = Array.from({ length: fmt.ch }, (_, c) => Float32Array.from({ length: n }, (_, i) => dv.getInt16(data.at + (i * fmt.ch + c) * 2, true) / 32768));
  return { channels, sampleRate: fmt.sr };
};

await test('bundled default hitsounds exist, decode, and mix at the caught objects only', async () => {
  const dir = path.join(root, 'assets/default-sounds');
  const files = new Map();
  for (const b of ['normal', 'soft', 'drum']) for (const n of ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap', 'slidertick']) files.set(`${b}-${n}.wav`, new Uint8Array(fs.readFileSync(path.join(dir, `${b}-${n}.wav`))));
  files.set('catch-banana.wav', new Uint8Array(fs.readFileSync(path.join(dir, 'catch-banana.wav'))));
  const bm = parseOsu(hsMap('0,500,4,1,1,100,1,0', '100,300,1000,5,0,0:0:0:0:\n480,300,1500,1,2,0:0:0:0:\n256,192,3000,12,0,3300'));
  const sc = buildScene(bm, 0);
  const track = new ReplayTrack([{ t: 0, x: 100, dash: false }, { t: 5000, x: 100, dash: false }]);   // catches only the first fruit (and nearby bananas)
  evaluateCatches(sc, track);
  const sources = [{ label: 'default', layer: 'default', files }];
  const { events, missing } = await HS.collectHitsounds(sc, { sources, decode: async (b) => decodeWav(b) });
  assert.deepEqual(missing, []);
  assert.ok(events.some((e) => e.t === 1000), 'first fruit plays');
  assert.ok(!events.some((e) => e.t === 1500), 'a missed fruit is silent');
  const SR = 48000;
  const mono = (ch) => { const n = ch.length; return [new Float32Array(n), new Float32Array(n)]; };
  const out = mono(new Float32Array(SR * 5));
  HS.mixHitsounds(out, events, { startTime: 0, rate: 1, sampleRate: SR });
  const energy = (a, b) => { let e = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += out[0][i] ** 2; return e; };
  assert.ok(energy(1.0, 1.2) > 0.01, 'sound at the caught fruit');
  assert.ok(energy(1.6, 2.8) === 0, 'silence where nothing was caught');
});

// ---------- HUD: combo and accuracy ----------
const SC = await import('../src/score.js');
const mk = (kind, t, caught) => ({ kind, t, caught });

await test('score: combo grows on catches, resets on a missed fruit, tiny droplets and bananas leave it alone', () => {
  const sc = { objects: [mk('fruit', 100, true), mk('droplet', 200, true), mk('tiny', 250, false), mk('banana', 260, false),
    mk('fruit', 300, true), mk('fruit', 400, false), mk('tiny', 450, true), mk('fruit', 500, true)] };
  const hud = SC.buildHud(sc);
  assert.equal(SC.hudAt(hud, 50).combo, 0);
  assert.equal(SC.hudAt(hud, 50).acc, 1);
  assert.equal(SC.hudAt(hud, 100).combo, 1);
  assert.equal(SC.hudAt(hud, 250).combo, 2, 'a missed tiny droplet keeps the combo');
  assert.equal(SC.hudAt(hud, 300).combo, 3);
  assert.equal(SC.hudAt(hud, 400).combo, 0, 'a missed fruit breaks it');
  assert.equal(SC.hudAt(hud, 450).combo, 0, 'a caught tiny droplet does not add');
  assert.equal(SC.hudAt(hud, 500).combo, 1);
  assert.equal(SC.hudAt(hud, 500).maxCombo, 3);
  assert.equal(hud.totals.bananas, 1);
  // 7 judged objects (banana excluded), 5 caught
  assert.ok(Math.abs(SC.hudAt(hud, 9999).acc - 5 / 7) < 1e-12);
});

await test('score: replay count cross-check', () => {
  const sc = { objects: [mk('fruit', 1, true), mk('droplet', 2, true), mk('tiny', 3, true), mk('tiny', 4, false), mk('fruit', 5, false)] };
  const { totals } = SC.buildHud(sc);
  assert.ok(SC.compareWithReplay(totals, { n300: 1, n100: 1, n50: 1, nKatu: 1, nMiss: 1, maxCombo: 2 }).ok);
  const bad = SC.compareWithReplay(totals, { n300: 2, n100: 1, n50: 1, nKatu: 1, nMiss: 1, maxCombo: 2 });
  assert.ok(!bad.ok && bad.diffs.length === 1 && /fruits caught/.test(bad.diffs[0]));
  assert.ok(bad.near, 'one fruit off is timing noise');
  assert.ok(!SC.compareWithReplay(totals, { n300: 9, n100: 1, n50: 1, nKatu: 1, nMiss: 1, maxCombo: 2 }).near, 'a big gap is a real mismatch');
  assert.ok(!SC.compareWithReplay(totals, { n300: 1, n100: 1, n50: 1, nKatu: 1, nMiss: 1, maxCombo: 50 }).near, 'a combo gap with equal misses is real');
});

await test('findJudgeShift: only a shift that makes every count match is used', () => {
  // the catcher stands at 100 until 1000 ms, then at 300; the catcher jumps at 1000 ms
  const track = { xAt: (t) => (t < 1000 ? 100 : 300) };
  const mkObj = (x, t) => ({ kind: 'fruit', x, t, caught: false });
  const scene = { catchWidth: 20, objects: [mkObj(100, 995), mkObj(300, 1005)] };
  const want = (n300, nMiss, maxCombo) => ({ n300, n100: 0, n50: 0, nKatu: 0, nMiss, maxCombo });
  assert.equal(findJudgeShift(scene, track, want(2, 0, 2)), 0, 'plain check already right: no shift');
  const late = { catchWidth: 20, objects: [mkObj(100, 1003), mkObj(300, 1010)] };       // plain check: 1st missed
  assert.equal(findJudgeShift(late, track, want(2, 0, 2)), -4, 'shifts earlier until it matches, smallest first');
  assert.equal(findJudgeShift(late, track, want(5, 0, 5)), 0, 'no shift can explain it: left alone');
});

await test('skin.ini [Fonts] prefixes and spacing', () => {
  const ini = parseSkinIni('[Fonts]\nScorePrefix: numbers/s\nComboPrefix: numbers/c\nScoreOverlap: 3\nComboOverlap: -2\n');
  assert.equal(ini.scorePrefix, 's'); assert.equal(ini.comboPrefix, 'c');   // folders dropped: skin files are looked up by base name
  assert.equal(ini.scoreOverlap, 3); assert.equal(ini.comboOverlap, -2);
  const d = parseSkinIni('');
  assert.equal(d.scorePrefix, 'score'); assert.equal(d.comboPrefix, 'score');
});


await test('buildScene marks the last object before each new combo (stream: its last nested object; shower: its last banana)', () => {
  const osu = OSU.replace(/\[HitObjects\][\s\S]*$/, '[HitObjects]\n100,300,1000,5,0,0:0:0:0:\n200,300,1500,1,0,0:0:0:0:\n300,300,2000,5,0,0:0:0:0:\n256,192,3000,12,0,3600\n400,300,4500,5,0,0:0:0:0:\n420,300,5000,1,0,0:0:0:0:\n');
  const sc = buildScene(parseOsu(osu), 0);
  const last = sc.objects.filter((o) => o.lastInCombo);
  assert.deepEqual(last.map((o) => [o.kind, o.t]).filter(([k]) => k !== 'banana'), [['fruit', 1500]], 'only the fruit before the new combo');
  assert.equal(last.filter((o) => o.kind === 'banana').length, 1);
  const lastBanana = sc.objects.filter((o) => o.kind === 'banana').pop();
  assert.ok(lastBanana.lastInCombo);
  assert.ok(!sc.objects.find((o) => o.t === 5000).lastInCombo, 'the final object of the map is not flagged');
});


// ---------- plate: stacking, drop and explode ----------
const PL = await import('../src/plate.js');

await test('plate: fruit stack on the plate, droplets leave at once, a caught combo end explodes and a missed one drops', () => {
  const track = new ReplayTrack([{ t: 0, x: 256, dash: false }, { t: 9000, x: 256, dash: false }]);
  const f = (t, x, extra = {}) => ({ kind: 'fruit', t, x, caught: true, offset: x - 256, ...extra });
  const scene = { fruitScale: 0.5, catcherScale: 1, objects: [
    f(1000, 256), f(1100, 256),                                          // two fruit on the same spot: the second is pushed away
    { kind: 'droplet', t: 1200, x: 260, caught: true, offset: 4 },       // droplets never stay
    f(1300, 250, { lastInCombo: true }),                                 // caught combo end: explode
    f(2000, 256),
    f(2100, 300, { caught: false, offset: 44, lastInCombo: true }),      // missed combo end: drop
  ] };
  const plate = PL.buildPlate(scene, track);
  const at = (t) => PL.plateAt(plate, t, 256);
  assert.equal(at(500).length, 0);
  const two = at(1150);
  assert.equal(two.length, 2); assert.ok(two.every((p) => p.onPlate));
  assert.ok(Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y) >= 10 - 1e-9 || two[0].y !== two[1].y, 'the second fruit does not sit exactly on the first');
  assert.ok(two[1].y <= two[0].y, 'it is nudged upward, never down');
  const drop = at(1210).find((p) => p.obj.kind === 'droplet');
  assert.ok(drop && !drop.onPlate, 'the droplet is already flying off');
  const exploding = at(1300 + 500);
  assert.ok(exploding.length >= 3 && exploding.every((p) => !p.onPlate), 'the whole plate explodes on the combo end');
  assert.ok(exploding.every((p) => p.alpha > 0 && p.alpha < 1));
  assert.equal(at(1300 + 800).filter((p) => p.obj.t <= 1300).length, 0, 'gone after 750 ms');
  assert.equal(at(2050).filter((p) => p.onPlate).length, 1);
  const dropped = at(2100 + 400);
  assert.equal(dropped.length, 1); assert.ok(!dropped[0].onPlate);
  assert.ok(dropped[0].y > 384 - 5, 'a dropped fruit falls');
  assert.equal(at(2100 + 800).length, 0);
});


await test('hit lighting: fruit get flash + glow scaled by the combo, droplets only the glow, everything ends on time', () => {
  const track = new ReplayTrack([{ t: 0, x: 256, dash: false }, { t: 9000, x: 256, dash: false }]);
  const scene = { fruitScale: 0.5, catcherScale: 1, catchWidth: 85.4, objects: [
    { kind: 'fruit', t: 1000, x: 256, caught: true, offset: 0, comboBefore: 0 },
    { kind: 'fruit', t: 2000, x: 256, caught: true, offset: 0, comboBefore: 400 },
    { kind: 'droplet', t: 3000, x: 300, caught: true, offset: 44, comboBefore: 5 },
  ] };
  const plate = PL.buildPlate(scene, track);
  assert.equal(PL.explosionsAt(plate, scene, 900).length, 0, 'nothing before the catch');
  const a = PL.explosionsAt(plate, scene, 1160);
  assert.equal(a.length, 1); assert.ok(a[0].flash && a[0].glow);
  assert.ok(Math.abs(a[0].flash.sx - 16 * 0.35) < 1e-9, 'combo 0 uses the minimum scale 0.35, fully grown after 160 ms');
  assert.ok(Math.abs(a[0].flash.alpha - (1 - 160 / 300)) < 1e-9);
  const b = PL.explosionsAt(plate, scene, 2160)[0];
  assert.ok(Math.abs(b.flash.sx - 16 * 1.125) < 1e-9, 'combo 400 is capped at 1.125');
  const early = PL.explosionsAt(plate, scene, 1000)[0];
  assert.ok(Math.abs(early.flash.sx - 1) < 1e-9 && Math.abs(early.flash.sy - 0.9) < 1e-9, 'starts as a thin flash');
  const d = PL.explosionsAt(plate, scene, 3100);
  assert.equal(d.length, 1); assert.equal(d[0].flash, null); assert.ok(d[0].glow);
  assert.ok(d[0].offset > 0 && d[0].offset <= scene.catchWidth / 2, 'offset follows the droplet and stays inside the catch width');
  assert.equal(PL.explosionsAt(plate, scene, 1000 + 301).filter((e) => e.flash).length, 0, 'flash gone after 300 ms');
  assert.equal(PL.explosionsAt(plate, scene, 1000 + 701).length, 0, 'glow gone after 700 ms');
});

await test('spin seed: every judged object gets the stateless random for its start time', () => {
  const sc = buildScene(parseOsu(OSU), 0);
  for (const o of sc.objects) {
    if (o.kind === 'banana') continue;
    assert.equal(o.rot0, statelessSingle(Math.trunc(o.t), 1));
    assert.ok(o.rot0 >= 0 && o.rot0 < 1);
  }
});


// ---------- Nightcore beat ----------
const { nightcoreBeats } = await import('../src/nightcore.js');
const tp = (time, bl, extra = {}) => ({ time, beatLength: bl, uninherited: true, meter: 4, omitFirstBarLine: false, ...extra });

await test('nightcore beat: 4/4 pattern on half beats, finish + kick on the segment start, hats only with an even tick rate', () => {
  const bm = { timingPoints: [tp(0, 500)], sliderTickRate: 2 };      // 120 bpm: a beat every 250 ms
  const ev = nightcoreBeats(bm, 0, 9000);
  const at = (t) => ev.filter((e) => e.t === t).map((e) => e.sample).sort();
  assert.deepEqual(at(0), ['finish', 'kick']);
  assert.deepEqual(at(250), ['hat']);
  assert.deepEqual(at(500), ['clap']);
  assert.deepEqual(at(750), ['hat']);
  assert.deepEqual(at(1000), ['kick']);
  assert.deepEqual(at(8000), ['finish', 'kick'], 'segment = 4 bars x 4 beats x 2 = 32 half beats = 8 s');
  const noHats = nightcoreBeats({ timingPoints: [tp(0, 500)], sliderTickRate: 1 }, 0, 2000);
  assert.ok(!noHats.some((e) => e.sample === 'hat'), 'odd tick rate: no hats');
  assert.deepEqual(noHats.filter((e) => e.t === 500).map((e) => e.sample), ['clap']);
});

await test('nightcore beat: 3/4 uses kick / clap every 6 half beats, omitted bar line skips the opening finish, start before the first point waits for beat 0', () => {
  const three = nightcoreBeats({ timingPoints: [tp(0, 600, { meter: 3 })], sliderTickRate: 1 }, 0, 2000);   // half beat = 300
  assert.deepEqual(three.filter((e) => e.t === 0).map((e) => e.sample).sort(), ['finish', 'kick']);
  assert.deepEqual(three.filter((e) => e.t === 900).map((e) => e.sample), ['clap']);
  assert.deepEqual(three.filter((e) => e.t === 1800).map((e) => e.sample), ['kick']);
  const omit = nightcoreBeats({ timingPoints: [tp(0, 500, { omitFirstBarLine: true })], sliderTickRate: 1 }, 0, 600);
  assert.ok(!omit.some((e) => e.sample === 'finish'), 'no cymbal on the omitted first bar');
  assert.deepEqual(omit.filter((e) => e.t === 250).map((e) => e.sample), ['kick'], 'with the flag, the first played beat is one half beat later');
  const early = nightcoreBeats({ timingPoints: [tp(1000, 500)], sliderTickRate: 1 }, -2000, 1600);
  assert.ok(early.every((e) => e.t >= 1000), 'nothing before the first timing point');
  assert.deepEqual(early.filter((e) => e.t === 1000).map((e) => e.sample).sort(), ['finish', 'kick']);
});

await test('nightcore beat: a later timing point takes over from its own time; starting mid-song begins at the current segment', () => {
  const bm = { timingPoints: [tp(0, 500), tp(1100, 1000)], sliderTickRate: 1 };
  const ev = nightcoreBeats(bm, 0, 3000);
  assert.ok(!ev.some((e) => e.t > 1000 && e.t < 1100), 'the 1250 beat of the old tempo never plays');
  assert.deepEqual(ev.filter((e) => e.t === 1100).map((e) => e.sample).sort(), ['finish', 'kick'], 'new point restarts the pattern');
  assert.ok(ev.some((e) => e.t === 2100 && e.sample === 'clap'), 'new half beat is 500 ms: the clap is the 3rd half beat');
  const mid = nightcoreBeats({ timingPoints: [tp(0, 500)], sliderTickRate: 1 }, 4100, 5000);
  assert.deepEqual(mid.filter((e) => e.t === 4100).map((e) => e.sample), ['kick'], 'half beat 16 of the loop is a kick, fired as soon as the song runs');
  assert.ok(mid.length > 0 && mid[0].t === 4100, 'the loop is already running when the song starts');
});

// ---------- score and HP ----------
const HP = await import('../src/health.js');
const mkRun = (spec, extra = {}) => ({ mods: 0, hp: 5, breaks: [], ...extra,
  objects: spec.map(([kind, t, caught = true]) => ({ kind, t, caught })) });

await test('score: osu!stable ScoreV1 - hit values plus a combo bonus scaled by the map stars and mods', () => {
  // stars = round((HP + OD + CS + clamp(objects / drainSeconds * 8, 0, 16)) / 38 * 5): (5+5+5+8)/38*5 = 3.03 -> 3
  const legacy = { hp: 5, od: 5, cs: 5, objects: 100, drainMs: 100000 };
  assert.equal(SC.peppyStars(legacy), 3);
  const sc = (spec, extra = {}) => SC.buildHud(mkRun(spec, { legacy, ...extra })).totals.score;
  // first two hits have no combo bonus; the third gets 1 step: 300 * 1 * 3 * 1 / 25 = 36
  assert.equal(sc([['fruit', 100], ['fruit', 200], ['fruit', 300]]), 300 + 300 + 336);
  assert.equal(sc([['fruit', 100], ['tiny', 150], ['droplet', 200], ['banana', 250]]), 300 + 10 + 100 + 1100);
  // a miss resets the combo: no bonus after it
  assert.equal(sc([['fruit', 100], ['fruit', 200], ['fruit', 300, false], ['fruit', 400], ['fruit', 500]]), 300 * 4);
  // a missed tiny keeps the combo
  assert.equal(sc([['fruit', 100], ['fruit', 200], ['tiny', 250, false], ['fruit', 300]]), 300 + 300 + 336);
  // mods scale the bonus: HR 1.12 -> 300 * 1 * 3 * 1.12 / 25 = 40.32 -> 40
  assert.equal(sc([['fruit', 100], ['fruit', 200], ['fruit', 300]], { mods: 16 }), 300 + 300 + 340);
});

await test('score: mod multipliers (osu!stable) and the 1 s roll-up of the counter', () => {
  near(SC.scoreMultiplier(0), 1);
  near(SC.scoreMultiplier(2), 0.5);
  near(SC.scoreMultiplier(16 | 8), 1.12 * 1.06);
  near(SC.scoreMultiplier(64 | 512 | 8), 1.12 * 1.06);
  near(SC.scoreMultiplier(256), 0.3);
  const hud = SC.buildHud(mkRun([['fruit', 1000], ['fruit', 1100]]));
  const v = SC.hudAt(hud, 1100);
  assert.equal(SC.scoreShownAt(v, 1100), Math.round(v.scoreFrom), 'right at the judgement the counter still shows the old value');
  assert.equal(SC.scoreShownAt(v, 1100 + 1000), v.score, 'a second later it has arrived');
  const half = SC.scoreShownAt(v, 1100 + 500);
  assert.ok(half > v.scoreFrom && half < v.score);
  assert.equal(SC.scoreShownAt(SC.hudAt(hud, 10), 10), 0);
});

await test('slow motion: windows around misses merge, the video gets longer, times and audio map through the warp', async () => {
  const { buildWarp } = await import('../src/warp.js');
  const { warpAudio } = await import('../src/audio.js');
  assert.equal(buildWarp([], 10000), null);
  const w = buildWarp([2000, 2100, 6000], 10000, { speed: 0.5, before: 200, after: 300 });
  assert.equal(w.segs.filter((x) => x.speed < 1).length, 2, 'the two close misses share one window');
  // slowed: [1800, 2400] and [5800, 6300] -> 600 -> 1200 ms and 500 -> 1000 ms, so +1100 ms in all
  assert.ok(Math.abs(w.totalV - 11100) < 1e-6);
  assert.ok(Math.abs(w.vToU(1000) - 1000) < 1e-6, 'before the first window time is unchanged');
  assert.ok(Math.abs(w.vToU(1800 + 600) - (1800 + 300)) < 1e-6, 'inside a window the play moves at half speed');
  assert.ok(Math.abs(w.vToU(w.totalV) - 10000) < 1e-6 && Math.abs(w.vToU(-5)) < 1e-9);
  const sr = 8000, len = 10 * sr;
  const tone = Float32Array.from({ length: len }, (_, i) => 0.5 * Math.sin(i / 20));
  const out = warpAudio([tone, tone], w, sr);
  assert.equal(out[0].length, Math.round((w.totalV / 1000) * sr), 'the audio is as long as the slowed video');
  assert.ok(out[0].some((x) => Math.abs(x) > 0.3) && out[0].every(Number.isFinite));
});

await test('experimental extras: every overlay draws without error and changes the picture', async () => {
  const E = await import('../src/extras.js');
  const { createCanvas } = (await import('node:module')).createRequire(import.meta.url)('@napi-rs/canvas');
  const sc = { preempt: 800, fruitRadius: 20, catchWidth: 90, objects: [
    { kind: 'fruit', t: 1000, x: 250, offset: 5, caught: true }, { kind: 'droplet', t: 1200, x: 100, offset: -60, caught: false },
    { kind: 'tiny', t: 1300, x: 300, offset: 0, caught: true }, { kind: 'fruit', t: 1500, x: 400, offset: 40, caught: true }] };
  assert.deepEqual(E.missTimes(sc), [1200], 'only fruits and droplets that were missed');
  const blank = (draw) => { const c = createCanvas(600, 700), g = c.getContext('2d'); draw(g); return g.getImageData(0, 0, 600, 700).data.some((v) => v); };
  const track = { xAt: (t) => 200 + t / 20 };
  assert.ok(blank((g) => E.drawHitboxes(g, sc, 0, 4, 1100, 250, 1)), 'hitboxes');
  assert.ok(blank((g) => E.drawMissFlash(g, 300, 300, sc, 1300)), 'flash right after the miss');
  assert.ok(!blank((g) => E.drawMissFlash(g, 300, 300, sc, 3000)), 'no flash long after');
  assert.ok(blank((g) => E.drawKeyPad(g, { left: [[0, 500]], right: [], dash: [] }, 100)), 'input overlay');
  assert.ok(blank((g) => E.drawTrail(g, track, 2000)), 'trail');
  assert.ok(blank((g) => E.drawCatchMeter(g, sc, 1600)), 'meter');
});

await test('health: starts full, drains between objects, catching refills, a missed fruit costs 3-20% by HP, tinies and bananas cost nothing', () => {
  const sc = mkRun([['fruit', 1000], ['fruit', 2000, false], ['tiny', 3000, false], ['banana', 4000, false], ['fruit', 5000]], { hp: 0 });
  const h = HP.buildHealth(sc);
  near(HP.healthAt(h, 0), 1);
  near(HP.healthAt(h, 1000), 1, 1e-9);
  const before = HP.healthAt(h, 1999), after = HP.healthAt(h, 2000);
  near(before - after, 0.03 - 0, 1e-6, 'HP 0 miss costs 3%');
  near(HP.healthAt(h, 2999) - HP.healthAt(h, 3000), 0, 1e-6);
  assert.ok(HP.healthAt(h, 1500) < 1 || h.drain === 0);
  const hard = HP.buildHealth(mkRun([['fruit', 1000], ['fruit', 2000, false]], { hp: 10 }));
  assert.ok(HP.healthAt(hard, 1999) - HP.healthAt(hard, 2000) > 0.19, 'HP 10 miss costs about 20%');
});

await test('health: a perfect run stays near the legacy floor for its HP and never leaves 0..1; breaks stop the drain', () => {
  const objs = [];
  for (let i = 0; i < 400; i++) objs.push(['fruit', 1000 + i * 250]);
  for (const hp of [2, 5, 8]) {
    const sc = mkRun(objs, { hp });
    const h = HP.buildHealth(sc);
    let lo = 1;
    for (let t = 0; t <= 101000; t += 50) { const v = HP.healthAt(h, t); assert.ok(v >= 0 && v <= 1); lo = Math.min(lo, v); }
    assert.ok(lo > 0.25 && lo < 1, `hp ${hp}: lowest ${lo}`);
    assert.ok(h.drain > 0);
  }
  // a break between 10000 and 40000: health does not move while it lasts
  const withBreak = mkRun([['fruit', 1000], ['fruit', 10000, false], ['fruit', 40000, false], ['fruit', 41000]], { hp: 5, breaks: [{ start: 12000, end: 38000 }] });
  const hb = HP.buildHealth(withBreak);
  near(HP.healthAt(hb, 10001), HP.healthAt(hb, 39999), 1e-12);
});

// ---------- pp ----------
const PP = await import('../src/pp.js');
const ppScene = (mods = 0) => {
  const bm = parseOsu(OSU.replace(/\[HitObjects\][\s\S]*$/, '') + '[HitObjects]\n' +
    Array.from({ length: 200 }, (_, i) => `${40 + ((i * 137) % 430)},300,${1000 + i * 140},${i % 8 === 0 ? 5 : 1},0,0:0:0:0:`).join('\n') + '\n');
  const scene = buildScene(bm, mods);
  const track = new ReplayTrack([{ t: 0, x: 256, dash: false }, { t: 40000, x: 256, dash: false }]);
  evaluateCatches(scene, track);
  return scene;
};

await test('pp: formula spot checks (CatchPerformanceCalculator)', () => {
  // star 5, AR 9, 1000 fruit, full combo, 100% accuracy
  const v = PP.catchPerformance({ star: 5, maxCombo: 1000 }, { n300: 1000, n100: 0, n50: 0, nKatu: 0, nMiss: 0, maxCombo: 1000 }, { mods: 0, ar: 9 });
  const base = (5 * (5 / 0.0049) - 4) ** 2 / 100000;
  near(v, base * (0.95 + 0.3 * (1000 / 2500)), 1e-6);
  const miss = PP.catchPerformance({ star: 5, maxCombo: 1000 }, { n300: 990, n100: 0, n50: 0, nKatu: 0, nMiss: 10, maxCombo: 500 }, { mods: 0, ar: 9 });
  assert.ok(miss < v * 0.97 ** 10 * 1, 'misses, a lower max combo and lower accuracy all cut pp');
  const hd = PP.catchPerformance({ star: 5, maxCombo: 1000 }, { n300: 1000, n100: 0, n50: 0, nKatu: 0, nMiss: 0, maxCombo: 1000 }, { mods: 8, ar: 9 });
  near(hd / v, 1.05 + 0.075 * 1, 1e-9, 'hidden at AR 9');
});

await test('pp: star rating grows as the map is played, DT raises it, and a perfect play ends at the max pp', () => {
  const sc = ppScene();
  const d = sc.diff;
  for (let i = 1; i < d.steps.length; i++) assert.ok(d.steps[i].maxCombo >= d.steps[i - 1].maxCombo);
  assert.ok(d.star > 1 && d.star < 12);
  assert.equal(d.steps[d.steps.length - 1].star, d.star);
  assert.ok(ppScene(64).diff.star > d.star, 'double time is harder');
  assert.equal(PP.livePp(d, sc, { n300: 0, n100: 0, n50: 0, nKatu: 0, nMiss: 0, maxCombo: 0 }, 0), 0, 'before the first object there is no pp');
  const all = { n300: 0, n100: 0, n50: 0, nKatu: 0, nMiss: 0, maxCombo: d.maxCombo };
  for (const o of sc.objects) { if (o.kind === 'fruit') all.n300++; else if (o.kind === 'droplet') all.n100++; else if (o.kind === 'tiny') all.n50++; }
  near(PP.livePp(d, sc, all, 1e9), sc.maxPp, 1e-9);
});

await test('pp: hud entries carry the judgement counts live pp needs', () => {
  const hud = SC.buildHud({ objects: [mk('fruit', 100, true), mk('droplet', 150, false), mk('tiny', 160, false), mk('tiny', 170, true), mk('banana', 180, true)] });
  const v = SC.hudAt(hud, 1000);
  assert.deepEqual([v.n300, v.n100, v.n50, v.nKatu, v.nMiss], [1, 0, 1, 1, 1]);
});

// ---------- overlay: background, keys, rank ----------
const KEYS = await import('../src/keys.js');
const { rankOf, layout } = await import('../src/render.js');

await test('keys: left / right inferred from the movement, dash from the flag, presses counted per run', () => {
  const frames = [
    { t: 0, x: 100, dash: false }, { t: 20, x: 100, dash: false },
    { t: 40, x: 90, dash: false }, { t: 60, x: 80, dash: true },          // left from 20 to 60, dash from 60
    { t: 80, x: 80, dash: true }, { t: 100, x: 80, dash: false },         // standing still, dash ends at 100
    { t: 120, x: 95, dash: false }, { t: 140, x: 110, dash: false },      // right from 100 to 140
    { t: 400, x: 110, dash: false }, { t: 420, x: 100, dash: false },     // left again from 400
  ];
  const k = KEYS.buildKeys(frames);
  assert.deepEqual(k.left, [[20, 60], [400, 420]]);
  assert.deepEqual(k.right, [[100, 140]]);
  assert.deepEqual(k.dash, [[60, 100]]);
  const a = KEYS.keysAt(k, 50);
  assert.deepEqual([a.left.down, a.left.count, a.right.count, a.dash.count], [true, 1, 0, 0]);
  const b = KEYS.keysAt(k, 80);
  assert.deepEqual([b.left.down, b.dash.down, b.dash.count], [false, true, 1]);
  assert.equal(KEYS.keysAt(k, 1000).left.count, 2);
  assert.equal(KEYS.keysAt(k, 1000).left.down, false);
  // a dash still held at the last frame is closed there
  assert.deepEqual(KEYS.buildKeys([{ t: 0, x: 0, dash: true }, { t: 50, x: 0, dash: true }]).dash, [[0, 50]]);
});

await test('rank letters like stable: SS / S / A / B / C / D, with H for HD or FL', () => {
  assert.equal(rankOf(1, 0), 'SS');
  assert.equal(rankOf(1, 8), 'SSH');
  assert.equal(rankOf(0.985, 1024), 'SH');
  assert.equal(rankOf(0.95, 8), 'A');
  assert.equal(rankOf(0.91, 0), 'B');
  assert.equal(rankOf(0.86, 0), 'C');
  assert.equal(rankOf(0.5, 0), 'D');
});

await test('background: parsed from [Events], found in the .osz by its (case-insensitive) name, overlay layout fills the height', () => {
  const bm = parseOsu('osu file format v14\n\n[Events]\n//Background and Video events\n0,0,"Folder\\BG.JPG",0,0\nVideo,0,"v.avi"\n2,1000,3000\n\n[Difficulty]\nHPDrainRate:6\n');
  assert.equal(bm.background, 'Folder\\BG.JPG');
  assert.deepEqual(bm.breaks, [{ start: 1000, end: 3000 }]);
  assert.equal(bm.hp, 6);
  const osz = { images: new Map([['bg.jpg', new Uint8Array([1, 2, 3])]]) };
  assert.deepEqual([...OSZ.findImage(osz, bm.background)], [1, 2, 3]);
  assert.equal(OSZ.findImage(osz, 'other.png'), null);
  const L = layout(1920, 1080, true);
  near(L.ox + 256 * L.s, 960, 1e-6);
  near(L.s * 384, 0.861 * 1080, 1e-6);
});


await test('tosu overlays: tokens and markup follow the real overlays\' bindings', async () => {
  const T = await import('../src/tosu.js');
  assert.equal(T.mmss(61000), '01:01');
  assert.equal(T.gradeToken(1, 0), 'SS');
  assert.equal(T.gradeToken(1, 8), 'SSH');
  assert.equal(T.gradeToken(0.9865, 0), 'S');
  assert.equal(T.gradeToken(0.95, 0), 'A');
  assert.equal(T.modsToken(8 | 64), 'HD,DT');
  assert.equal(T.modsToken(0), 'NM');
  const scene = { objects: [{ t: 1000 }, { t: 61000 }], mods: 0,
    meta: { title: 'T<&>', artistUnicode: 'A', creator: 'C', version: 'V' },
    hud: { timeline: [{ t: 2000, combo: 25, acc: 0.9865, nMiss: 1 }, { t: 3000, combo: 3, acc: 0.98, nMiss: 1 }] },
    diff: { maxCombo: 100, steps: [] }, maxPp: 500 };
  const k = T.tosuTokens(scene, 3500);
  assert.equal(k.time, '00:03');
  assert.equal(k.combo, 3);
  assert.equal(k.currentMaxCombo, 25);
  assert.equal(k.fcing, false);
  assert.equal(k.maxCombo, 100);
  assert.equal(k.ppIfRestFced, 500);
  assert.match(T.titleHtml(k, null), /T&lt;&amp;&gt;/);
  assert.match(T.accHtml(k), /class="rank"/);
  assert.doesNotMatch(T.accHtml(k), /class="pp"/, 'the pp counter is InGame3\'s now');
  assert.match(T.ppHtml(k), /id="pp"/);
  assert.match(T.ppHtml(k), /opacity:1/, 'the if-FC bubble shows after a miss');
  assert.match(T.ppHtml({ ...k, fcing: true }), /opacity:0/);
  assert.match(T.comboHtml(k), /\(25\)/);
  assert.doesNotMatch(T.comboHtml({ ...k, fcing: true }), /\(25\)/);
});

await test('version: the stamp in version.js, index.html and every ?v= import agree', async () => {
  const { VERSION } = await import('../src/version.js');
  assert.match(VERSION, /^\d{8}[a-z]$/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(/<meta name="app-version" content="([^"]+)"/.exec(html)?.[1], VERSION);
  const stamps = new Set();
  for (const f of [...fs.readdirSync(path.join(root, 'src')).map((n) => path.join(root, 'src', n)), path.join(root, 'index.html')]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\?v=(\w+)/g)) stamps.add(m[1]);
  }
  assert.deepEqual([...stamps], [VERSION]);
});

await test('background video: [Events] Video line parsed, videos read from the .osz and found by name', async () => {
  const bm = parseOsu('osu file format v14\n[General]\nMode: 2\n[Events]\n0,0,"bg.jpg",0,0\nVideo,-1500,"Intro/Clip.MP4",0,0\n2,100,200\n');
  assert.deepEqual(bm.video, { file: 'Intro/Clip.MP4', offset: -1500 });
  assert.equal(bm.background, 'bg.jpg');
  assert.equal(parseOsu('osu file format v14\n[Events]\n1,0,"x.avi",0,0\n').video.offset, 0);
  assert.equal(parseOsu('osu file format v14\n[Events]\n0,0,"bg.jpg"\n').video, null);
  const OSZ = await import('../src/osz.js');
  const zip = zipSync({ 'a.osu': strToU8('osu file format v14\n'), 'sub/Clip.MP4': new Uint8Array([9, 9]), 'bg.jpg': new Uint8Array([1]) });
  const osz = OSZ.readOsz(zip);
  assert.deepEqual([...OSZ.findVideo(osz, 'clip.mp4')], [9, 9]);
  assert.equal(OSZ.findVideo(osz, 'other.mp4'), null);
});

await test('custom styles: every non-tosu look exists, draws in its own box, and persists through normalize', async () => {
  const L = await import('../src/layout.js'), S = await import('../src/styles.js');
  const calls = [];
  const ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 8 }), font: '12px x' }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push(k); return /^create.*Gradient$/.test(String(k)) ? { addColorStop() {} } : undefined; }),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const scene = { objects: [{ t: 0 }, { t: 60000 }], meta: { title: 'T', artist: 'A', version: 'D', creator: 'M', cs: 4, ar: 9, od: 8, hp: 5, bpm: 180, lengthMs: 90000 }, diff: { star: 6.1 }, hud: null };
  const d = S.styleData(scene, 1000, null, null);
  let drawn = 0;
  for (const id of L.ORDER) for (const st of L.WIDGETS[id].styles) {
    if (st.tosu || st.system) continue;
    const look = S.lookFor(id, st.id);
    assert.equal(typeof look, 'function', `${id}/${st.id} has a look`);
    look(ctx, d, st.w, st.h);
    drawn++;
  }
  assert.ok(drawn >= 9 && calls.length > 50);
  for (const id of L.ORDER) for (const st of L.WIDGETS[id].styles) assert.ok(st.tosu || st.system || S.lookFor(id, st.id), `${id}/${st.id} is drawn by something`);
  assert.equal(L.defaultLayout().keys.style, 'stable');
  const n = L.normalizeLayout({ title: { style: 'kerli1' }, pp: { style: 'nope' } });
  assert.equal(n.title.style, 'kerli1');
  assert.equal(n.pp.style, 'ingame3');
  near(L.rectOf('title', n, 1920, 1080)[2], 794);
});

await test('layout presets and files: built-ins are valid and on screen, files round-trip, junk is rejected', async () => {
  const L = await import('../src/layout.js');
  assert.deepEqual(L.PRESETS.map((p) => p.id), ['cpol', 'lazer', 'stable', 'simpleoverlay', 'souei', 'paradox', 'victim']);
  for (const p of L.PRESETS) {
    const l = p.build();
    assert.deepEqual(L.normalizeLayout(l), l, `${p.id} is already normalized`);
    assert.ok(ORDER_ON(L, l) > 3, `${p.id} shows widgets`);
    for (const id of L.ORDER) {
      if (!l[id].on) continue;
      const [x, y, w, h] = L.rectOf(id, l, 1920, 1080);
      assert.ok(x >= -1 && y >= -1 && x + w <= 1925 && y + h <= 1085, `${p.id}/${id} fits the frame: ${[x, y, w, h].map(Math.round)}`);
    }
  }
  assert.equal(L.PRESETS[2].build().acc.style, 'stable');
  const l = L.PRESETS[1].build();
  assert.deepEqual(L.parseLayoutFile(L.layoutFileText(l)), l);
  assert.deepEqual(L.parseLayoutFile(JSON.stringify(l)), l);
  assert.equal(L.parseLayoutFile('nope'), null);
  assert.equal(L.parseLayoutFile('{"a":1}'), null);
  function ORDER_ON(M, lay) { return M.ORDER.filter((id) => lay[id].on).length; }
});

await test('custom layout: defaults match the old overlay places, bad data is repaired, hit-testing and snapping work', async () => {
  const L = await import('../src/layout.js');
  const d = L.defaultLayout();
  assert.deepEqual(Object.keys(d), L.ORDER);
  assert.equal(d.title.on && d.pp.on && d.acc.on && d.combo.on && d.keys.on, true);
  assert.equal(d.hits.on || d.progress.on, false);
  const [x, y, w, h] = L.rectOf('title', d, 1920, 1080);          // title: 6 px in, 8 px down, 800 x 90 drawn at 1.222
  near(x, 6); near(y, 8); near(w, 800 * 1.222 * 0.73); near(h, 90 * 1.222);
  const full = L.fullRectOf('title', d, 1920, 1080);                // the drawn box is the visible part plus its empty margin
  near(full[0], 6); near(full[2], 800 * 1.222);
  const [, , w2] = L.rectOf('title', d, 960, 540);                // same layout at half the size
  near(w2, w / 2);
  const bad = L.normalizeLayout({ title: { on: 'yes', x: 'a', y: 99, s: 50 }, nonsense: 1 });
  assert.equal(bad.title.on, true);
  assert.ok(bad.title.y <= 1.5 && bad.title.s <= L.MAX_SCALE);
  assert.deepEqual(L.normalizeLayout(null), d);
  // the topmost shown widget wins, hidden ones are skipped
  const l = L.defaultLayout();
  l.keys.x = l.combo.x; l.keys.y = l.combo.y;
  const [kx, ky] = L.rectOf('keys', l, 1920, 1080);
  assert.equal(L.hitTest(l, 1920, 1080, kx + 5, ky + 5), 'keys');
  l.keys.on = false;
  assert.equal(L.hitTest(l, 1920, 1080, kx + 5, ky + 5), 'combo');
  assert.equal(L.hitTest(l, 1920, 1080, 960, 540), null);
  // a widget dragged far off screen is pulled back so a quarter of it stays visible
  const [cx] = L.clampPosition('title', l, -5, 0.2, 1920, 1080);
  assert.ok(cx > -0.75 * 800 * 1.222 * 0.73 / 1920 - 1e-9);
  // dragging a widget near the centre line snaps it there
  const [sx, , g] = L.snapPosition('keys', l, 0.5 - 0.0005 - L.rectOf('keys', l, 1920, 1080)[2] / 1920 / 2, 0.3, 1920, 1080);
  near(sx + L.rectOf('keys', l, 1920, 1080)[2] / 1920 / 2, 0.5);
  assert.equal(g.x, 0.5);
});

await test('countUp: rolls to a new value over about half a second and holds still otherwise', async () => {
  const C = await import('../src/countup.js?v=20261111x');
  C.setSmoothNumbers(true);
  const raw = (t) => (t < 5000 ? 100 : 200);
  assert.equal(C.countUp(raw, 4000), 100);
  const mid = C.countUp(raw, 5100);
  assert.ok(mid > 100 && mid < 200, `mid-roll value ${mid}`);
  assert.ok(C.countUp(raw, 5100) < C.countUp(raw, 5300));
  assert.ok(Math.abs(C.countUp(raw, 5700) - 200) < 0.2);
  C.setSmoothNumbers(false);
  assert.equal(C.countUp(raw, 5100), 200);
  C.setSmoothNumbers(true);
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
