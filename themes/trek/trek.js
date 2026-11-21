/* frerk.co/trek: 1990s background MIDI, played by a small Web Audio synth.
   Browsers dropped MIDI playback (and <bgsound>) long ago, so this reads the .mid file
   itself and plays it with oscillators. Browsers also block sound until the reader
   clicks or presses a key, so the music starts on the first click or key press anywhere,
   unless the reader switched it off (remembered in localStorage). */
(() => {
  "use strict";
  const KEY = "frerk-trek-midi";
  const pref = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: fine */ } },
  };
  const AC = window.AudioContext || window.webkitAudioContext;
  const midiUrl = document.body.dataset.midi;
  const ui = {
    toggle: document.getElementById("midi-toggle"),
    play: document.getElementById("midi-play"),
    stop: document.getElementById("midi-stop"),
    status: document.getElementById("midi-status"),
    hint: document.getElementById("engage-hint"),
  };

  // ------------------------------------------------------------ Standard MIDI File reader
  function parseMidi(buf) {
    const d = new DataView(buf);
    let p = 0;
    const text = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
    const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
    const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = v * 128 + (b & 0x7f); } while (b & 0x80); return v; };
    if (text(4) !== "MThd") throw new Error("not a MIDI file");
    const hlen = u32(); u16(); const ntracks = u16(); const division = u16();
    if (division & 0x8000) throw new Error("SMPTE timing not supported");
    p = 8 + hlen;
    const ev = [];
    let endTick = 0;
    for (let t = 0; t < ntracks && p < d.byteLength; t++) {
      if (text(4) !== "MTrk") throw new Error("bad track");
      const len = u32();
      const end = p + len;
      let tick = 0, status = 0, seq = 0;
      while (p < end) {
        tick += vlq();
        if (d.getUint8(p) & 0x80) status = d.getUint8(p++);
        const type = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          const kind = d.getUint8(p++), len = vlq();
          if (kind === 0x51) ev.push({ tick, seq: seq++, tempo: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
          if (kind === 0x2f) endTick = Math.max(endTick, tick);
          p += len;
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq();
        } else if (type === 0x90 || type === 0x80) {
          const note = d.getUint8(p++), vel = d.getUint8(p++);
          ev.push({ tick, seq: seq++, ch, note, vel: type === 0x90 ? vel : 0 });
        } else if (type === 0xc0) {
          ev.push({ tick, seq: seq++, ch, program: d.getUint8(p++) });
        } else if (type === 0xd0) {
          p += 1;
        } else {
          p += 2;
        }
      }
      p = end;
    }
    // ticks -> seconds through the tempo map; pair note-ons with note-offs
    ev.sort((a, b) => a.tick - b.tick || (a.tempo !== undefined ? -1 : 0) - (b.tempo !== undefined ? -1 : 0) || (a.vel === 0 ? -1 : 0) - (b.vel === 0 ? -1 : 0) || a.seq - b.seq);
    let tempo = 500000, lastTick = 0, sec = 0;
    const toSec = (tk) => { sec += ((tk - lastTick) * tempo) / division / 1e6; lastTick = tk; return sec; };
    const program = {}, open = {}, notes = [];
    for (const e of ev) {
      const s = toSec(e.tick);
      if (e.tempo !== undefined) { tempo = e.tempo; continue; }
      if (e.program !== undefined) { program[e.ch] = e.program; continue; }
      const k = e.ch * 128 + e.note;
      if (e.vel > 0) {
        (open[k] = open[k] || []).push({ t: s, ch: e.ch, note: e.note, vel: e.vel / 127, prog: program[e.ch] || 0 });
      } else if (open[k] && open[k].length) {
        const n = open[k].shift();
        n.dur = Math.max(0.03, s - n.t);
        notes.push(n);
      }
    }
    notes.sort((a, b) => a.t - b.t);
    return { notes, length: toSec(Math.max(endTick, lastTick)) };
  }

  // ------------------------------------------------------------ the synth
  let ctx = null, master = null, reverb = null, bus = null;
  let song = null, songPromise = null;
  let playing = false, timer = null, origin = 0, idx = 0, lap = 0;

  const PATCH = {
    60: { osc: [["sawtooth", -5], ["sawtooth", 5]], a: 0.05, d: 0.4, s: 0.75, r: 0.25, bright: 3, lvl: 0.11, wet: 0.35, vib: 4.5 }, // French horn
    61: { osc: [["sawtooth", -9], ["sawtooth", 9], ["square", 0]], a: 0.03, d: 0.3, s: 0.8, r: 0.2, bright: 4, lvl: 0.07, wet: 0.3 },  // brass section
    48: { osc: [["sawtooth", -12], ["sawtooth", 0], ["sawtooth", 12]], a: 0.35, d: 1, s: 0.9, r: 0.8, bright: 3, lvl: 0.035, wet: 0.55 }, // strings
    43: { osc: [["triangle", 0], ["sine", -1200]], a: 0.02, d: 0.5, s: 0.6, r: 0.2, bright: 6, lvl: 0.2, wet: 0.15 },              // contrabass
    8: { osc: [["sine", 0], ["sine", 1200], ["triangle", 2400]], a: 0.004, d: 0.35, s: 0, r: 0.9, bright: 12, lvl: 0.05, wet: 0.65, perc: true }, // celesta
    73: { osc: [["sine", 0], ["triangle", 0]], a: 0.09, d: 0.3, s: 0.85, r: 0.25, bright: 5, lvl: 0.1, wet: 0.5, vib: 5.2 },       // flute
  };

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function setupAudio() {
    if (ctx) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp);
    comp.connect(ctx.destination);
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.6, 2.4);
    reverb.connect(master);
  }

  function newBus() {
    bus = { dry: ctx.createGain(), wet: ctx.createGain() };
    bus.dry.connect(master);
    bus.wet.connect(reverb);
  }

  function route(node, wet) {
    node.connect(bus.dry);
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send);
    send.connect(bus.wet);
  }

  function timpani(t, freq, vel) {
    const g = ctx.createGain(), o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.02, 0.35);
    o.connect(g);
    route(g, 0.35);
    o.start(t);
    o.stop(t + 2);
    // the mallet: a short low thump of noise
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = noiseBuffer();
    f.type = "lowpass";
    f.frequency.value = 500;
    ng.gain.setValueAtTime(0.25 * vel, t);
    ng.gain.setTargetAtTime(0, t, 0.03);
    n.connect(f); f.connect(ng); route(ng, 0.2);
    n.start(t);
    n.stop(t + 0.3);
  }

  let noise = null;
  function noiseBuffer() {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  }

  function voice(n, t) {
    const freq = hz(n.note);
    if (n.prog === 47) return timpani(t, freq, n.vel);
    const P = PATCH[n.prog] || PATCH[73];
    const amp = ctx.createGain(), filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = 0.7;
    const top = Math.min(14000, freq * P.bright * (0.6 + n.vel));
    filt.frequency.setValueAtTime(Math.min(top, freq * 1.5), t);
    filt.frequency.linearRampToValueAtTime(top, t + P.a + 0.02);
    filt.frequency.setTargetAtTime(Math.max(freq * 1.2, top * 0.6), t + P.a, P.d);
    const peak = P.lvl * (0.35 + 0.65 * n.vel);
    const end = t + n.dur;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + P.a);
    if (P.perc) {
      amp.gain.setTargetAtTime(0, t + P.a, P.r / 3);
    } else {
      amp.gain.setTargetAtTime(peak * P.s, t + P.a, P.d / 3);
      amp.gain.setTargetAtTime(0, Math.max(end, t + P.a), P.r / 3);
    }
    const stopAt = (P.perc ? t + P.a : Math.max(end, t + P.a)) + P.r * 2.5;
    let lfo = null;
    if (P.vib) {
      lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = P.vib;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(freq * 0.006, t + 0.4);
      lfo.connect(depth);
      lfo.start(t);
      lfo.stop(stopAt);
      lfo.depth = depth;
    }
    for (const [type, cents] of P.osc) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = cents;
      if (lfo) lfo.depth.connect(o.frequency);
      o.connect(filt);
      o.start(t);
      o.stop(stopAt);
    }
    filt.connect(amp);
    route(amp, P.wet);
  }

  function pump() {
    if (!playing || !song || !song.notes.length) return;
    const horizon = ctx.currentTime + 1.2;
    for (;;) {
      if (idx >= song.notes.length) { idx = 0; lap++; }
      const n = song.notes[idx];
      const t = origin + lap * song.length + n.t;
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.02) voice(n, t);
      idx++;
    }
  }

  // ------------------------------------------------------------ sound effects (original, synthesized)
  function whoosh() {
    const t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer();
    bp.type = "bandpass";
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 1.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.7);
    g.gain.setTargetAtTime(0, t + 0.8, 0.18);
    src.connect(bp); bp.connect(g); route(g, 0.6);
    src.start(t);
    src.stop(t + 2);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 1);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.12, t + 0.6);
    og.gain.setTargetAtTime(0, t + 0.9, 0.12);
    o.connect(og); route(og, 0.6);
    o.start(t);
    o.stop(t + 2);
  }

  function chirp() {
    if (!ctx || ctx.state !== "running" || !master) return;
    if (!bus) newBus();
    const t = ctx.currentTime + 0.01;
    [[1320, 0], [1760, 0.07]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.08, t + dt + 0.005);
      g.gain.setTargetAtTime(0, t + dt + 0.04, 0.01);
      o.connect(g); route(g, 0.1);
      o.start(t + dt);
      o.stop(t + dt + 0.2);
    });
  }

  // ------------------------------------------------------------ transport + UI
  function loadSong() {
    if (!songPromise) {
      songPromise = fetch(midiUrl)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((b) => (song = parseMidi(b)))
        .catch((e) => { songPromise = null; throw e; });
    }
    return songPromise;
  }

  function render(state) {
    const on = state === "playing";
    document.body.classList.toggle("midi-on", on);
    if (ui.toggle) {
      ui.toggle.setAttribute("aria-pressed", on ? "true" : "false");
      ui.toggle.querySelector("span").textContent = on ? "ON" : "OFF";
    }
    if (ui.status) ui.status.textContent = { idle: "click anywhere", playing: "now playing", stopped: "stopped", loading: "loading…", error: "no sound :(" }[state];
    if (ui.hint) ui.hint.hidden = on || pref.get() === "off";
  }

  function start(withWhoosh) {
    if (!AC || playing) return;
    setupAudio();
    if (ctx.state !== "running") ctx.resume();
    render("loading");
    loadSong().then(() => {
      if (playing) return;
      playing = true;
      newBus();
      if (withWhoosh) whoosh();
      origin = ctx.currentTime + (withWhoosh ? 1.1 : 0.15);
      idx = 0;
      lap = 0;
      pump();
      timer = setInterval(pump, 200);
      render("playing");
    }, () => render("error"));
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    timer = null;
    if (bus && ctx) {
      const now = ctx.currentTime;
      bus.dry.gain.setTargetAtTime(0, now, 0.05);
      bus.wet.gain.setTargetAtTime(0, now, 0.3);
      bus = null;
    }
    render("stopped");
  }

  function userStart() { pref.set("on"); setupAudio(); ctx.resume(); start(true); }
  function userStop() { pref.set("off"); stop(); }

  if (!AC || !midiUrl) {
    render("error");
    return;
  }

  ui.play && ui.play.addEventListener("click", (e) => { e.stopPropagation(); userStart(); });
  ui.stop && ui.stop.addEventListener("click", (e) => { e.stopPropagation(); userStop(); });
  ui.toggle && ui.toggle.addEventListener("click", (e) => { e.stopPropagation(); playing ? userStop() : userStart(); });
  document.querySelectorAll(".side .btn").forEach((b) => b.addEventListener("click", chirp));

  // first click or key press anywhere engages the music (the 1997 experience). Touch
  // screens grant sound only on some events (touchend, click), so keep listening until
  // the audio is actually running.
  const gestures = ["pointerdown", "pointerup", "keydown", "touchend", "click"];
  const detach = () => gestures.forEach((g) => document.removeEventListener(g, engage, true));
  function engage(e) {
    if (e.target && e.target.closest && e.target.closest(".midi-box, #midi-toggle")) return;
    if (pref.get() === "off") { detach(); return; }
    setupAudio();
    const r = ctx.resume();
    start(true);
    if (ctx.state === "running") detach();
    else if (r && r.then) r.then(() => { if (ctx.state === "running") detach(); }, () => {});
  }
  gestures.forEach((g) => document.addEventListener(g, engage, true));

  // pause with the tab, so a background tab stays quiet and never drifts
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (playing) ctx.resume();
  });

  loadSong().catch(() => render("error"));
  render(pref.get() === "off" ? "stopped" : "idle");
})();
