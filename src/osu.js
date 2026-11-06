// Parser for .osu beatmap files (only the parts osu!catch needs).
// Works for native osu!catch maps (Mode: 2) and for osu!standard maps converted to catch (Mode: 0):
// both store circles / sliders / spinners the same way, which map to fruits / juice streams / bananas.

export function parseOsu(text) {
  const bm = {
    formatVersion: 14,
    mode: 0,
    audioFilename: '', audioLeadIn: 0,
    sampleSet: 1, sampleVolume: 100,   // [General] SampleSet (1 normal, 2 soft, 3 drum) and default volume
    title: '', artist: '', artistUnicode: '', version: '', creator: '',
    cs: 5, ar: null, od: 5, hp: 5,
    background: '',                    // [Events] background image file name
    breaks: [],                        // [Events] break periods: {start, end} in ms
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
    timingPoints: [],
    colours: [],
    hitObjects: [],
  };

  let section = '';
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('osu file format v')) { bm.formatVersion = parseInt(line.slice(17), 10) || 14; continue; }
    if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1); continue; }

    if (section === 'TimingPoints') {
      const p = line.split(',');
      const time = parseFloat(p[0]);
      const beatLength = parseFloat(p[1]);
      if (!Number.isFinite(time) || !Number.isFinite(beatLength)) continue;
      const uninherited = p.length > 6 ? p[6].trim() === '1' : beatLength > 0;
      const meter = p.length > 2 ? parseInt(p[2], 10) : 4;
      const omitFirstBarLine = p.length > 7 ? ((parseInt(p[7], 10) || 0) & 8) !== 0 : false; // effects bit 3
      const kiai = p.length > 7 ? ((parseInt(p[7], 10) || 0) & 1) === 1 : false; // effects bit 0
      const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
      bm.timingPoints.push({
        time, beatLength, uninherited, kiai, omitFirstBarLine,
        meter: Number.isFinite(meter) && meter > 0 ? meter : 4,
        sampleSet: p.length > 3 ? num(p[3], bm.sampleSet) : bm.sampleSet,
        sampleIndex: p.length > 4 ? num(p[4], 0) : 0,
        volume: p.length > 5 ? num(p[5], bm.sampleVolume) : bm.sampleVolume,
      });
    } else if (section === 'Events') {
      const parts = line.split(',');
      if (parts[0] === '0' && parts[2] && !bm.background) {
        const name = parts[2].replace(/^"|"$/g, '').trim();
        if (/\.(jpe?g|png)$/i.test(name)) bm.background = name;
      }
      if (parts[0] === '2' || parts[0] === 'Break') {
        const start = parseFloat(parts[1]), end = parseFloat(parts[2]);
        if (Number.isFinite(start) && Number.isFinite(end)) bm.breaks.push({ start, end });
      }
    } else if (section === 'HitObjects') {
      const h = parseHitObject(line);
      if (h) bm.hitObjects.push(h);
    } else {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (section === 'General' && key === 'Mode') bm.mode = parseInt(val, 10) || 0;
      else if (section === 'General' && key === 'AudioFilename') bm.audioFilename = val;
      else if (section === 'General' && key === 'SampleSet') bm.sampleSet = { normal: 1, soft: 2, drum: 3 }[val.toLowerCase()] ?? 1;
      else if (section === 'General' && key === 'SampleVolume') bm.sampleVolume = parseInt(val, 10) || 100;
      else if (section === 'General' && key === 'AudioLeadIn') bm.audioLeadIn = parseInt(val, 10) || 0;
      else if (section === 'Metadata') {
        if (key === 'Title') bm.title = val;
        else if (key === 'Artist') bm.artist = val;
        else if (key === 'ArtistUnicode') bm.artistUnicode = val;
        else if (key === 'Version') bm.version = val;
        else if (key === 'Creator') bm.creator = val;
      } else if (section === 'Difficulty') {
        const n = parseFloat(val);
        if (key === 'CircleSize') bm.cs = n;
        else if (key === 'ApproachRate') bm.ar = n;
        else if (key === 'OverallDifficulty') bm.od = n;
        else if (key === 'HPDrainRate') bm.hp = n;
        else if (key === 'SliderMultiplier') bm.sliderMultiplier = n;
        else if (key === 'SliderTickRate') bm.sliderTickRate = n;
      } else if (section === 'Colours' && /^Combo\d+$/.test(key)) {
        const rgb = val.split(',').map((v) => parseInt(v, 10));
        if (rgb.length >= 3 && rgb.every(Number.isFinite)) bm.colours[parseInt(key.slice(5), 10) - 1] = rgb.slice(0, 3);
      }
    }
  }

  if (bm.ar === null || Number.isNaN(bm.ar)) bm.ar = bm.od; // old maps: AR == OD
  bm.colours = bm.colours.filter(Boolean);
  bm.hitObjects.sort((a, b) => a.time - b.time);
  return bm;
}

function parseHitObject(line) {
  const p = line.split(',');
  if (p.length < 4) return null;
  const x = parseFloat(p[0]);
  const y = parseFloat(p[1]);
  const time = parseFloat(p[2]);
  const type = parseInt(p[3], 10);
  if (![x, y, time, type].every(Number.isFinite)) return null;

  const h = { x, y, time, type, newCombo: !!(type & 4), comboSkip: (type >> 4) & 7, hitSound: parseInt(p[4], 10) || 0, sampleStr: '' };

  if (type & 2) {
    // slider / juice stream: curveType|x:y|x:y,slides,length
    const parts = (p[5] || '').split('|');
    const curveType = parts[0] || 'B';
    const points = parts.slice(1).map((s) => {
      const [px, py] = s.split(':').map(Number);
      return { x: px, y: py };
    }).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
    h.kind = 'stream';
    h.curveType = curveType;
    // control points relative to the object's own position
    h.points = [{ x: 0, y: 0 }, ...points.map((q) => ({ x: q.x - x, y: q.y - y }))];
    h.slides = Math.max(1, parseInt(p[6], 10) || 1);
    h.pixelLength = parseFloat(p[7]) || 0;
    h.edgeSounds = p[8] || '';   // per node hit sound types, "2|0|4"
    h.edgeSets = p[9] || '';     // per node banks, "1:0|2:2|0:0"
    h.sampleStr = p[10] || '';
  } else if (type & 8) {
    h.kind = 'shower'; // spinner -> banana shower
    h.endTime = parseFloat(p[5]) || time;
    h.sampleStr = p[6] || '';
  } else {
    h.kind = 'fruit';
    h.sampleStr = p[5] || '';
  }
  return h;
}
