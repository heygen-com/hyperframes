#!/usr/bin/env python3
"""Beat-grid + drum/event analysis engine for music-to-video.

Turns a BGM track directly into a deterministic `audiomap.json` — the music skeleton
that the Director and Builder hang visuals on. It merges:

  - a reliable tempo + beat grid + downbeat (librosa beat tracker),
  - metrical position per event (strong / weak / syncopated / off-grid) over a 16th-note bar grid,
  - drum-element classification (kick / snare / hihat / perc) via band-split,
  - special audio events (riser / glitch / crash-impact / hard-stop silence),
  - an energy narrative (audio-driven energy phases + builds + key moments; the Music
    Reader names the sections — no fixed Intro/Build/Drop/Outro template),
  - a phrase layer + per-section density budgets for visual planning.

Output is the canonical `audiomap.json` documented in the skill.

Usage:
    python3 analyze-beatgrid.py track.mp3 -o audiomap.json
    python3 analyze-beatgrid.py track.mp3 --print          # also print a readable brief

Deps: ffmpeg/ffprobe on PATH + librosa, numpy, soundfile (band-split heuristics,
no learned models / no madmom).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

SR = 22050
HOP = 512  # ~23 ms frames
AUDIOMAP_VERSION = 2


# ── decode ────────────────────────────────────────────────────────────────
def load_audio(path: str) -> tuple[np.ndarray, int, float]:
    """Decode any ffmpeg-readable file to mono float32 @ SR via a temp wav."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav = tmp.name
    subprocess.run(
        ["ffmpeg", "-y", "-i", path, "-ac", "1", "-ar", str(SR), wav],
        capture_output=True, check=True,
    )
    y, sr = sf.read(wav, dtype="float32")
    Path(wav).unlink(missing_ok=True)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return y, sr, len(y) / sr


# ── tempo + beat grid + downbeat phase ──────────────────────────────────────
def beat_grid(y: np.ndarray, sr: int) -> dict:
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP, units="frames")
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    return {"bpm": float(np.atleast_1d(tempo)[0]), "beats": beats, "beat_frames": beat_frames}


def _norm_flux(band: np.ndarray) -> np.ndarray:
    """Positive first-difference (onset flux) of a band-energy curve, normalized."""
    flux = np.maximum(0.0, np.diff(np.sqrt(band), prepend=band[:1]))
    return flux / (flux.max() + 1e-9)


def band_energy_curves(y: np.ndarray, sr: int) -> dict:
    """Per-frame band energy + per-band normalized onset flux (for drum typing)."""
    S = np.abs(librosa.stft(y, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr)
    # Tight drum bands: kick fundamental, snare body, hihat sizzle. Narrow bands
    # keep one drum's transient from leaking into another's flux on a full mix.
    low = (freqs < 150)                       # kick
    mid = (freqs >= 150) & (freqs < 900)      # snare body
    high = (freqs >= 5000)                    # hihat / cymbal
    e_low, e_mid, e_high = S[low].sum(axis=0), S[mid].sum(axis=0), S[high].sum(axis=0)
    return {
        "S": S,
        "low": e_low, "mid": e_mid, "high": e_high,
        "total": S.sum(axis=0) + 1e-9,
        "flux_low": _norm_flux(e_low), "flux_mid": _norm_flux(e_mid), "flux_high": _norm_flux(e_high),
        "flatness": librosa.feature.spectral_flatness(S=np.sqrt(S))[0],
        "centroid": librosa.feature.spectral_centroid(S=np.sqrt(S), sr=sr)[0],
        "n": S.shape[1],
    }


def downbeat_phase(beat_frames: np.ndarray, bc: dict, beats_per_bar: int = 4) -> int:
    """Pick the bar phase whose beats carry the most KICK (low-band) energy."""
    kick = bc["low"] / bc["total"]
    best_p, best_score = 0, -1.0
    for p in range(beats_per_bar):
        idx = [bf for i, bf in enumerate(beat_frames) if (i - p) % beats_per_bar == 0]
        idx = [min(f, bc["n"] - 1) for f in idx]
        score = float(np.sum([kick[f] for f in idx])) if idx else 0.0
        if score > best_score:
            best_p, best_score = p, score
    return best_p


# ── metrical position: strong / weak / syncopated / off-grid ─────────────────
# 16-step bar grid (4 beats x 4 sixteenths). Strength by metrical weight.
GRID_CLASS = {0: "strong", 8: "strong", 4: "weak", 12: "weak",
              2: "weak", 6: "weak", 10: "weak", 14: "weak"}  # else (odd 16ths) -> syncopated


def classify_metric(t: float, beats: np.ndarray, phase: int, bpb: int = 4) -> tuple:
    """Return (grid_class, bar, beat_in_bar, step16) for a time t."""
    if len(beats) < 2:
        return "off-grid", -1, -1, -1
    i = int(np.searchsorted(beats, t) - 1)
    i = max(0, min(i, len(beats) - 2))
    beat_dur = beats[i + 1] - beats[i]
    frac = (t - beats[i]) / max(beat_dur, 1e-6)         # 0..1 within the beat
    sixteenth = int(round(frac * 4)) % 4                # nearest 16th in beat
    carry = 1 if round(frac * 4) >= 4 else 0
    beat_idx = i + carry
    beat_in_bar = (beat_idx - phase) % bpb              # 0..3
    bar = (beat_idx - phase) // bpb
    step16 = beat_in_bar * 4 + sixteenth                # 0..15
    # distance to the nearest 16th line (in seconds) → off-grid test
    nearest = beats[i] + (round(frac * 4) / 4) * beat_dur
    if abs(t - nearest) > 0.5 * (beat_dur / 4):
        return "off-grid", bar, beat_in_bar + 1, step16
    return GRID_CLASS.get(step16, "syncopated"), bar, beat_in_bar + 1, step16


# ── drum classification (band-split heuristic) ──────────────────────────────
def frame_at(t: float, sr: int, n: int) -> int:
    return min(int(round(t * sr / HOP)), n - 1)


def classify_drum(t: float, bc: dict, sr: int) -> tuple:
    """(drum_type, energy_norm, feel): which band's onset TRANSIENT dominates.

    Uses per-band normalized flux (relative transient strength), the standard
    way to separate kick (low) / snare (mid+noise) / hihat (high). Falls back to
    glitch for noisy non-harmonic bursts and perc when no band clearly leads.
    """
    f = frame_at(t, sr, bc["n"])
    win = slice(max(0, f - 1), min(bc["n"], f + 2))
    fl = float(bc["flux_low"][win].max())
    fm = float(bc["flux_mid"][win].max())
    fh = float(bc["flux_high"][win].max())
    lo = float(bc["low"][win].mean()); md = float(bc["mid"][win].mean())
    hi = float(bc["high"][win].mean()); tot = float(bc["total"][win].mean())
    flat = float(bc["flatness"][win].mean())
    lr, mr, hr = lo / tot, md / tot, hi / tot

    fluxes = {"kick": fl, "snare": fm, "hihat": fh}
    lead = max(fluxes, key=fluxes.get)
    lead_val = fluxes[lead]
    if lead_val < 0.06:                      # no real transient → texture/perc
        drum = "glitch" if flat > 0.30 else "perc"
    elif lead == "snare" and flat > 0.30 and mr < 0.30:
        drum = "glitch"                      # mid-band but noisy & thin → scratch/glitch
    else:
        drum = lead
    # feel (frequency character)
    has_bot, has_top, has_mid = lr > 0.30, hr > 0.20, mr > 0.30
    feel = ("full" if has_bot and has_top and has_mid else
            "heavy" if has_bot and not has_top else
            "bright" if has_top and not has_bot else
            "intimate" if has_mid else "sparse")
    return drum, tot, feel


# ── energy structure (RMS @1s) + sections + key moments + builds ────────────
def energy_structure(y: np.ndarray, sr: int, dur: float, first_onset: float = 0.0) -> dict:
    rms = librosa.feature.rms(y=y, hop_length=sr)[0]  # ~1s frames
    rms = rms / (rms.max() + 1e-9)
    norms = rms.tolist()

    def lvl(n):
        return "VOID" if n < 0.2 else "LOW" if n < 0.4 else "MEDIUM" if n < 0.65 else "HIGH"

    phases, cur, cs = [], None, 0
    for i, n in enumerate(norms):
        l = lvl(n)
        if l != cur:
            if cur:
                phases.append({"s": cs, "e": i, "lvl": cur})
            cur, cs = l, i
    if cur:
        phases.append({"s": cs, "e": len(norms), "lvl": cur})

    moments = []
    for i in range(1, len(norms)):
        d = norms[i] - norms[i - 1]
        if abs(d) > 0.12:
            moments.append({"t": i, "kind": "DROP" if d < 0 else "SURGE", "delta": round(d, 2)})
    moments.sort(key=lambda m: abs(m["delta"]), reverse=True)

    # hard stop: a HIGH→low cliff (a sudden stop) in the back third
    hard_stops = [m for m in moments if m["kind"] == "DROP" and m["t"] > dur * 0.6 and m["delta"] < -0.25]

    # NO forced Intro/Build/Drop/Outro template. The energy phases (audio-driven runs of
    # one energy level, variable count) are the raw structural blocks. The Music Reader
    # (LLM) decides the actual sections — count, boundaries, and free-form names — from
    # these phases + key_moments + rolls + hard_stops + phrases. Sections are
    # interpretation; only the timing they snap to is fact.
    phases_sec = []
    for p in phases:
        seg = norms[p["s"]:max(p["s"] + 1, p["e"])]
        phases_sec.append({
            "start": float(p["s"]),
            "end": float(min(p["e"], round(dur, 1))),
            "level": p["lvl"],
            "energy": round(float(np.mean(seg)) if seg else 0.0, 2),
        })

    return {"norms": [round(n, 2) for n in norms], "phases": phases_sec,
            "moments": moments[:8], "hard_stops": hard_stops}


# ── rolls / fills (localized rapid-onset runs) ───────────────────────────────
# A roll is where choreography should switch from discrete hits to a continuous /
# cascading visual (per-letter cascade, stagger). Derived straight from the onset
# stream — runs never overlap, so no dedup is needed (unlike a band-energy detector).
ROLL_MIN_HITS = 4
ROLL_CONT = 0.55      # × beat_dur: gap up to ~half a beat still keeps a run alive
ROLL_ACCEPT = 0.42    # × beat_dur: mean spacing denser than an 8th note counts
ROLL_DEDUP = 0.08     # seconds: merge onsets closer than a 32nd (double-trigger)


def detect_rolls(events: list, beat_dur: float) -> list:
    """Runs of >=4 onsets whose MEAN spacing is denser than an 8th note. Tuned so a
    full hihat/snare roll is captured as ONE span (not fragmented down to its tail),
    while a sparse groove stays out — validated against the golden 7.5-9.5s roll.
    The linear scan means runs never overlap (no LEGACY-style double-counting)."""
    cont = beat_dur * ROLL_CONT     # max gap that keeps a run alive
    accept = beat_dur * ROLL_ACCEPT  # max MEAN gap for a run to count
    # collapse onset double-triggers (two onsets < a 32nd apart = one hit) so a
    # held/sparse passage can't masquerade as a roll on a duplicated transient.
    ev = []
    for e in events:
        if ev and e["t"] - ev[-1]["t"] <= ROLL_DEDUP:
            if e.get("energy", 0) > ev[-1].get("energy", 0):
                ev[-1] = e
            continue
        ev.append(e)
    times = [e["t"] for e in ev]
    n = len(times)
    rolls, i = [], 0
    while i < n - 1:
        j = i
        while j + 1 < n and (times[j + 1] - times[j]) <= cont:
            j += 1
        if j - i + 1 >= ROLL_MIN_HITS:
            gaps = [times[k + 1] - times[k] for k in range(i, j)]
            if sum(gaps) / len(gaps) <= accept:
                t0, t1 = times[i], times[j]
                half = len(gaps) // 2
                accel = (half >= 1 and
                         sum(gaps[half:]) / (len(gaps) - half) <
                         sum(gaps[:half]) / half * 0.85)
                dcount: dict[str, int] = {}
                for e in ev[i:j + 1]:
                    dcount[e["drum"]] = dcount.get(e["drum"], 0) + 1
                rolls.append({
                    "start": round(t0, 3), "end": round(t1, 3),
                    "dur_sec": round(t1 - t0, 3),
                    "hits": j - i + 1,
                    "rate_per_min": round((j - i) / max(t1 - t0, 1e-6) * 60),
                    "kind": "accel-roll" if accel else ("sustained-fill" if t1 - t0 > 1.2 else "fill"),
                    "drum": max(dcount, key=dcount.get),
                })
        i = j + 1
    return rolls


# ── per-section spectral character (sustained "feel") ────────────────────────
# Coarse, reliable bands for how a SECTION sounds (not the noisy per-second dump).
# Distinct from a per-event `feel`, which is the transient color of a single hit.
FEEL_BANDS = [("sub", 0, 60), ("bass", 60, 250), ("low_mid", 250, 800),
              ("mid", 800, 2500), ("presence", 2500, 6000), ("air", 6000, 1e9)]


def annotate_section_feel(bc: dict, sr: int, sections: list) -> None:
    """Attach {character, bands} to each energy phase from its sustained band balance."""
    S, n = bc["S"], bc["n"]
    freqs = librosa.fft_frequencies(sr=sr)
    fps = sr / HOP
    masks = [(name, (freqs >= lo) & (freqs < hi)) for name, lo, hi in FEEL_BANDS]
    for s in sections:
        f0 = int(s["start"] * fps)
        f1 = min(max(f0 + 1, int(s["end"] * fps)), n)
        seg = S[:, f0:f1]
        if seg.shape[1] == 0 or s.get("energy", 0) < 0.15:
            s["feel"] = {"character": "sparse", "bands": []}
            continue
        en = {name: float(seg[m].sum()) for name, m in masks}
        tot = sum(en.values()) + 1e-9
        ratios = {name: en[name] / tot for name in en}
        present = sorted([bn for bn, r in ratios.items() if r > 0.12],
                         key=lambda bn: -ratios[bn])
        lo = ratios["sub"] + ratios["bass"]
        hi = ratios["presence"] + ratios["air"]
        mid = ratios["low_mid"] + ratios["mid"]
        char = ("heavy" if lo > 0.5 else "bright" if hi > 0.45 else
                "full" if lo > 0.25 and hi > 0.25 else
                "warm" if mid > 0.5 else "sparse")
        s["feel"] = {"character": char, "bands": present}


# ── audiomap enrichment: phrase layer + section density budgets ─────────────
def round3(n: float) -> float:
    return round(float(n), 3)


def derive_phrases(downbeats: list[float], phrase_bars: int, duration_sec: float) -> list:
    """Group downbeats into phrase spans of `phrase_bars` bars."""
    phrases = []
    if not downbeats:
        return phrases
    index = 0
    for i in range(0, len(downbeats), phrase_bars):
        start = downbeats[i]
        next_idx = i + phrase_bars
        end = downbeats[next_idx] if next_idx < len(downbeats) else duration_sec
        phrases.append({
            "index": index,
            "start": round3(start),
            "end": round3(end),
            "bars": min(phrase_bars, len(downbeats) - i),
        })
        index += 1
    return phrases


def count_in(times: list[float], start: float, end: float) -> int:
    return sum(1 for t in times if t >= start - 1e-6 and t < end - 1e-6)


def derive_phase_budgets(timeline: dict) -> list:
    """Attach an objective density read to each energy phase.

    Density is a fact (onsets-per-second + rolls). It is a hint for how much visual
    content a span can hold; it does not set timing or sections. The Music Reader uses
    these phases to decide the actual sections.
    """
    phases = timeline.get("energy_phases", [])
    onset_times = [e["t"] for e in timeline.get("events", [])]
    rolls = timeline.get("rolls", [])
    hard_stops = timeline.get("hard_stops", [])

    out = []
    for s in phases:
        span = max(1e-6, float(s.get("end", 0)) - float(s.get("start", 0)))
        onsets = count_in(onset_times, s["start"], s["end"])
        ph_rolls = [
            {"start": r["start"], "end": r["end"], "kind": r["kind"], "drum": r["drum"]}
            for r in rolls
            if r["start"] < s["end"] - 1e-6 and r["end"] > s["start"] + 1e-6
        ]
        ph_stops = [
            h["t"]
            for h in hard_stops
            if h["t"] >= s["start"] - 1e-6 and h["t"] < s["end"] + 1e-6
        ]

        if s.get("energy", 0) < 0.2 or onsets < 6:
            density = "sparse"
        elif onsets >= 18 or ph_rolls:
            density = "dense"
        else:
            density = "medium"

        enriched = dict(s)
        enriched["onsets"] = onsets
        enriched["onsetRate"] = round(onsets / span, 1)
        enriched["rolls"] = ph_rolls
        enriched["hardStops"] = ph_stops
        enriched["density"] = density
        out.append(enriched)
    return out


def finalize_audiomap(timeline: dict, phrase_bars: int = 4) -> dict:
    downbeats = timeline.get("grid", {}).get("downbeats_sec", [])
    duration_sec = timeline.get("audio", {}).get("duration_sec", 0)
    energy_phases = derive_phase_budgets(timeline)
    phrases = derive_phrases(downbeats, phrase_bars, duration_sec)
    return {
        "version": AUDIOMAP_VERSION,
        "phraseBars": phrase_bars,
        **timeline,
        "energy_phases": energy_phases,
        "phrases": phrases,
    }


# ── main ────────────────────────────────────────────────────────────────────
def analyze(path: str, phrase_bars: int = 4) -> dict:
    y, sr, dur = load_audio(path)
    bg = beat_grid(y, sr)
    bc = band_energy_curves(y, sr)
    phase = downbeat_phase(bg["beat_frames"], bc)
    beats = bg["beats"]
    downbeats = [float(beats[i]) for i in range(len(beats)) if (i - phase) % 4 == 0]

    # onsets → events
    onset_t = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=HOP, units="time", backtrack=True
    )
    en_at = bc["total"]
    en_max = float(en_at.max()) + 1e-9
    events = []
    for t in onset_t:
        gclass, bar, bib, step16 = classify_metric(float(t), beats, phase)
        drum, energy, feel = classify_drum(float(t), bc, sr)
        f = frame_at(float(t), sr, bc["n"])
        events.append({
            "t": round(float(t), 3),
            "bar": int(bar), "beat_in_bar": int(bib), "step16": int(step16),
            "grid": gclass, "drum": drum,
            "energy": round(float(en_at[f]) / en_max, 2), "feel": feel,
            "special": None,
        })

    first_onset = next((float(t) for t in onset_t if t >= 2.0), 0.0)
    es = energy_structure(y, sr, dur, first_onset)

    # tag specials onto nearby events
    for hs in es["hard_stops"]:
        for e in events:
            if abs(e["t"] - hs["t"]) < 0.6:
                e["special"] = "hard_stop"
    # riser: events inside a 1.5s+ rising-energy run that precedes a SURGE
    surges = [m["t"] for m in es["moments"] if m["kind"] == "SURGE"]
    for st in surges:
        for e in events:
            if st - 2.0 <= e["t"] < st and e["special"] is None and e["drum"] in ("perc", "glitch"):
                e["special"] = "riser"

    # rolls / fills + whether each leads straight into a surge/drop (cascade cue)
    beat_dur = float(np.median(np.diff(beats))) if len(beats) > 1 else 60.0 / max(bg["bpm"], 1e-6)
    rolls = detect_rolls(events, beat_dur)
    for r in rolls:
        r["leads_to"] = next((m["kind"] for m in es["moments"]
                              if 0 <= m["t"] - r["end"] <= 1.2), None)
    # near-silent windows (= VOID energy phases) — convenience for "hold / breathe"
    silences = [{"start": p["start"], "end": p["end"]}
                for p in es["phases"] if p["level"] == "VOID"]
    # per-phase sustained spectral character (how each energy block FEELS)
    annotate_section_feel(bc, sr, es["phases"])

    n_drum = {}
    for e in events:
        n_drum[e["drum"]] = n_drum.get(e["drum"], 0) + 1
    n_grid = {}
    for e in events:
        n_grid[e["grid"]] = n_grid.get(e["grid"], 0) + 1

    summary = (f"{bg['bpm']:.0f} BPM · {len(beats)} beats / {len(downbeats)} bars · "
               f"{len(events)} events ({n_drum}) · {len(rolls)} rolls · "
               f"{len(es['phases'])} energy phases · {dur:.1f}s")

    timeline = {
        "summary": summary,
        "audio": {"path": path, "duration_sec": round(dur, 3), "sr": sr},
        "tempo": {"bpm": round(bg["bpm"], 1), "beats_per_bar": 4,
                  "downbeat_phase": phase, "n_beats": len(beats), "n_bars": len(downbeats)},
        "grid": {"beats_sec": [round(float(b), 3) for b in beats],
                 "downbeats_sec": [round(b, 3) for b in downbeats]},
        "energy_phases": es["phases"],
        "key_moments": es["moments"],
        "hard_stops": es["hard_stops"],
        "rolls": rolls,
        "silences": silences,
        "stats": {"drum_counts": n_drum, "grid_counts": n_grid},
        "events": events,
    }
    return finalize_audiomap(timeline, phrase_bars)


def print_brief(d: dict) -> None:
    print(f"\n{d['summary']}\n{'='*70}")
    print("ENERGY PHASES (audio-driven blocks; the Music Reader names the sections)")
    for s in d.get("energy_phases", []):
        feel = s.get("feel", {})
        bands = ",".join(feel.get("bands", []))
        print(f"  {s['start']:5.1f}-{s['end']:5.1f}s  {s.get('level', ''):6s}  energy={s.get('energy')}  "
              f"{feel.get('character', ''):6s}  [{bands}]  {s.get('density', '?')}")
    print("PHRASES")
    for p in d.get("phrases", []):
        print(f"  #{p['index']}  {p['start']:5.2f}-{p['end']:5.2f}s  bars={p['bars']}")
    print("KEY MOMENTS")
    for m in d["key_moments"]:
        print(f"  {m['t']:3d}s  {m['kind']:5s}  Δ{m['delta']:+.2f}")
    print(f"HARD STOPS: {[h['t'] for h in d['hard_stops']]}")
    print("ROLLS / FILLS")
    for r in d.get("rolls", []):
        lead = f"  → {r['leads_to']}" if r.get("leads_to") else ""
        print(f"  {r['start']:6.2f}-{r['end']:5.2f}s  {r['hits']:2d} hits @ {r['rate_per_min']:4d}/min  "
              f"{r['kind']:10s} ({r['drum']}){lead}")
    print(f"SILENCES: {[(s['start'], s['end']) for s in d.get('silences', [])]}")
    print(f"DRUM COUNTS: {d['stats']['drum_counts']}    GRID: {d['stats']['grid_counts']}")
    print(f"\nEVENTS ({len(d['events'])})  [t · bar:beat · grid · drum · energy · special]")
    for e in d["events"]:
        sp = f"  <{e['special']}>" if e["special"] else ""
        print(f"  {e['t']:6.2f}s  b{e['bar']}:{e['beat_in_bar']}  {e['grid']:3s}  "
              f"{e['drum']:6s}  e={e['energy']:.2f}  {e['feel']:8s}{sp}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--phrase-bars", type=int, default=4)
    ap.add_argument("--print", action="store_true", dest="do_print")
    a = ap.parse_args()
    d = analyze(a.audio, phrase_bars=a.phrase_bars)
    if a.out:
        Path(a.out).write_text(json.dumps(d, ensure_ascii=False, indent=2))
        dens = " ".join(f"{s.get('level', '?')}:{s.get('density', '?')}" for s in d.get("energy_phases", []))
        print(
            f"[analyze-beatgrid] wrote audiomap {a.out} · {len(d.get('energy_phases', []))} phases · density [{dens}]",
            file=sys.stderr,
        )
    if a.do_print or not a.out:
        print_brief(d)


if __name__ == "__main__":
    main()
