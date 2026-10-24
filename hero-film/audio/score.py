# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
"""Muster hero loop: a bespoke 20 s score that loops seamlessly.

    MOTION_REEL_SKILL=<skill> python3 hero-film/audio/score.py      (or uv run)

120 BPM, 4/4, 40 beats = 20.0 s, E minor. The story the film tells, in sound:
  b0-8    SIGNAL   a clock ticking in eighths, a heartbeat sub, a dark Em(add9) pad, a three-note
                   pluck motif (E5 B4 G4) - the alert lands, someone has to decide what to do.
  b8-16   PLAN     bass eighths enter, claps on 2 and 4 from b12, the motif becomes a 16th arpeggio
                   whose filter opens; Em C Am B pulls toward the drop; riser b13-16.
  b16-28  RUN      four-on-the-floor, crash on 16, octave-bounce bass, wide pad. Em C G D.
  b28-36  REPORT   the lift: C G D Em with the filter all the way open, a brighter counter-line.
  b36-40  MUSTER   one big hit on 36 (end card), then the kick drops out; pad rings, the ticking
                   returns on b38 so the loop seam falls on a clock that never stopped.

The tail past 20 s (reverb, the last pad) is folded back onto the head, so the file loops with no
click and no gap. The grid is the designed one (synthesized, sample-exact), written to beats.json.

The sandbox has no PyPI access, so librosa is stubbed: dsp.py only needs it for measure_beats,
which a synthesized score doesn't need (its grid is known exactly).
"""
import json
import os
import sys
import types
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile


def _skill_dir():
    if os.environ.get("MOTION_REEL_SKILL"):
        return Path(os.environ["MOTION_REEL_SKILL"])
    found = sorted((Path.home() / ".claude/plugins").glob("**/skills/motion-reel/scripts/dsp.py"))
    if found:
        return found[-1].parent.parent
    sys.exit("can't find the motion-reel skill: set MOTION_REEL_SKILL")


try:
    import librosa  # noqa: F401
except ImportError:
    sys.modules["librosa"] = types.ModuleType("librosa")

sys.path.insert(0, str(_skill_dir() / "scripts"))
from dsp import *  # noqa: E402,F403
import dsp  # noqa: E402

HERE = Path(__file__).resolve().parent
FILM = HERE.parent
BPM = 120
BEAT = 60 / BPM
NB = 40
DUR = NB * BEAT
N = int(SR * DUR)
seed(20261024)


def T(b):
    return b * BEAT


# ---------------------------------------------------------------- house instruments

def tick(f=2600, length=0.03):
    n = int(length * SR)
    t = tvec(n)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.006)
    x += filt(dsp.rng.standard_normal(n), "highpass", 5000) * np.exp(-t / 0.002) * 0.5
    return x


def heart(f=46, length=0.5):
    n = int(length * SR)
    t = tvec(n)
    fr = f + 30 * np.exp(-t / 0.03)
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.16) * (1 - np.exp(-t / 0.004))
    return np.tanh(1.5 * x)


def bell(note, length=1.6):
    """Glassy FM bell for the motif's landing notes."""
    n = int(length * SR)
    t = tvec(n)
    f = hz(note)
    x = np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t / 0.35) * np.sin(2 * np.pi * f * 3.5 * t))
    return x * np.exp(-t / 0.55) * (1 - np.exp(-t / 0.002))


def snare_roll(length, n_hits, g0=0.2, g1=0.8):
    out = np.zeros(int(length * SR) + SR)
    # accelerating: hit k at length * (k/n)^0.7
    for k in range(n_hits):
        p = k / n_hits
        at = int(length * (p ** 0.75) * SR)
        c = clap(tight=True) * (g0 + (g1 - g0) * p)
        out[at:at + len(c)] += c[: len(out) - at]
    return out


# ---------------------------------------------------------------- harmony

EM = (["E3", "B3", "F#4", "G4"], "E2")
C_ = (["C3", "G3", "E4", "G4"], "C2")
AM = (["A2", "E3", "C4", "E4"], "A1")
B_ = (["B2", "F#3", "D#4", "A4"], "B1")
G_ = (["G2", "D3", "B3", "D4"], "G1")
D_ = (["D3", "A3", "F#4", "A4"], "D2")
HARMONY = [(0, EM), (8, EM), (10, C_), (12, AM), (14, B_), (16, EM), (20, C_), (24, G_), (26, D_),
           (28, C_), (30, G_), (32, D_), (34, B_), (36, EM)]


def chord_at(b):
    cur = HARMONY[0]
    for hb, ch in HARMONY:
        if b >= hb:
            cur = (hb, ch)
    return cur[1]


def segments():
    out = []
    for i, (hb, ch) in enumerate(HARMONY):
        end = HARMONY[i + 1][0] if i + 1 < len(HARMONY) else NB
        out.append((hb, end, ch))
    return out


def main():
    TAIL = 4.0
    drums, perc, bass, music, fx = (Bus(DUR + TAIL, BPM) for _ in range(5))

    # ---------------- the clock: eighth-note ticks, accent on the beat. Thins out on the drop
    for i in range(NB * 2):
        b = i / 2
        if 16 <= b < 36:
            continue                       # the kick carries time through RUN + REPORT
        on = i % 2 == 0
        perc.add(tick(2600 if on else 3400), b, 0.22 if on else 0.12, pan=0.35 if on else -0.35)

    # ---------------- heartbeat sub (lub-dub) in SIGNAL and PLAN, and again under the end card
    for b in list(range(0, 16, 2)) + [38]:
        drums.add(heart(), b, 0.75)
        drums.add(heart(52, 0.35), b + 0.5, 0.4)

    # ---------------- pad: dark in SIGNAL, opening through PLAN, wide on RUN, brightest on REPORT
    for a, e, (notes, root) in segments():
        if a < 8:
            cut = (420, 700)
        elif a < 16:
            cut = (700 + (a - 8) * 180, 900 + (a - 8) * 260)
        elif a < 28:
            cut = (2200, 2600)
        elif a < 36:
            cut = (3200, 4200)
        else:
            cut = (2600, 900)
        ln = T(e - a) + (1.6 if e == NB else 0.15)
        music.add(pad_chord(notes, ln, cut, attack=0.05 if a else 0.02, release=0.6 if e == NB else 0.12,
                            voices=5, detune=0.14), a, 0.55 if a >= 16 else 0.42)

    # ---------------- motif E5 B4 G4: plucked in SIGNAL, 16th arpeggio in PLAN
    for b0 in (0.5, 4.5):
        for k, nt in enumerate(("E5", "B4", "G4")):
            music.add(pluck([nt], 0.35, 2600), b0 + k * 0.5, 0.32, pan=0.2 - 0.2 * k)
    music.add(bell("E6", 1.8), 3.5, 0.10, pan=0.3)
    for i in range(32):
        b = 8 + i * 0.25
        notes, _ = chord_at(b)
        arp = [notes[1], notes[2], notes[3], notes[2]]
        nt = arp[i % 4]
        nt = nt[:-1] + str(int(nt[-1]) + 1)
        cut = 900 + 3600 * (i / 32) ** 1.4
        music.add(pluck([nt], 0.18, cut), b, 0.16 + 0.1 * (i / 32), pan=0.3 if i % 2 else -0.3)

    # ---------------- PLAN: claps from b12, riser and roll into the drop
    for b in (13, 15):
        drums.add(clap(), b, 0.45, pan=0.05)
    fx.add(riser(T(3.0)), 13, 0.28)
    fx.add(snare_roll(T(2.0), 16, 0.08, 0.55), 14, 0.5)

    # ---------------- RUN + REPORT: the groove b16-36
    for b in range(16, 36):
        drums.add(kick(), b, 0.95)
        if b % 2 == 1:
            drums.add(clap(), b, 0.42, pan=0.05)
        drums.add(hat(), b + 0.5, 0.22, pan=0.25)
        if b >= 20:
            drums.add(hat(), b + 0.75, 0.07, pan=-0.3)
        if b >= 28:
            drums.add(hat(), b + 0.25, 0.06, pan=-0.25)
    drums.add(hat(open_=True), 27.5, 0.18, pan=0.3)
    drums.add(crash(2.0), 16, 0.42)
    drums.add(crash(1.4), 28, 0.3)
    drums.add(sub_drop(1.4), 16, 0.6)
    fx.add(whoosh(T(1.0), 400, 5000, peak=0.85), 27, 0.22)
    fx.add(riser(T(2.0)), 34, 0.22)

    # ---------------- bass: eighths in PLAN, octave bounce on the groove, held root on the end card
    for i in range(16, 72):
        b = i / 2
        notes, root = chord_at(b)
        if b < 16:
            nt, g = root, 0.45 if i % 2 == 0 else 0.3
        else:
            nt = root[:-1] + str(int(root[-1]) + (1 if i % 2 else 0))
            g = 0.5 if i % 2 else 0.62
        bass.add(bass_note(nt, BEAT / 2 * 0.85, 900 if b < 16 else 1200), b, g)
    bass.add(bass_note("E2", T(3.6), 600), 36, 0.6)

    # ---------------- REPORT counter-line (brighter, answers each bar)
    line = [("B5", 28.5), ("D6", 29.0), ("E6", 29.5), ("D6", 31.5), ("B5", 32.0), ("A5", 32.5),
            ("F#6", 33.0), ("E6", 34.5), ("D#6", 35.0), ("F#6", 35.5)]
    for nt, b in line:
        music.add(pluck([nt], 0.3, 4200), b, 0.2, pan=0.25)

    # ---------------- MUSTER: end-card hit on 36, bell on the wordmark, motif returns as the loop seam
    drums.add(kick(), 36, 1.0)
    drums.add(crash(2.4), 36, 0.36)
    drums.add(sub_drop(1.6, 80, 32), 36, 0.55)
    music.add(bell("B5", 2.4), 36.5, 0.22, pan=-0.1)
    music.add(bell("E6", 2.4), 37.0, 0.16, pan=0.15)
    for k, nt in enumerate(("E5", "B4", "G4")):
        music.add(pluck([nt], 0.35, 2000), 38.5 + k * 0.5, 0.26, pan=0.2 - 0.2 * k)

    # ---------------- mix: kick pump, one shared reverb, fold the tail onto the head
    kick_t = [T(b) for b in range(16, 37)]
    n_all = bass.x.shape[1]
    pump = sidechain(kick_t, n_all, 0.45, 0.11)
    ir = reverb_ir(1.8, 0.45)
    wet_src = music.x * 0.4 + perc.x * 0.25 + fx.x * 0.15 + drums.x * 0.05
    wet = np.stack([signal.fftconvolve(wet_src[c], ir[c])[:n_all] for c in range(2)])
    bed = drums.x * 0.85 + perc.x * 0.8 + bass.x * pump * 0.8 + music.x * pump * 0.8 + fx.x * 0.7 + wet * 0.4
    bed = np.stack([filt(ch, "highpass", 28) for ch in bed])
    head = bed[:, :N].copy()
    tail = bed[:, N:]
    head[:, : tail.shape[1]] += tail[:, : N]
    head /= np.abs(head).max() + 1e-9
    head *= 0.5
    wavfile.write(HERE / "music.wav", SR, head.T.astype(np.float32))

    beats = [round(i * BEAT, 5) for i in range(NB + 1)]
    grid = {
        "bpm": BPM, "period": BEAT, "offset": 0.0, "beats": beats, "designed_bpm": BPM,
        "downbeats": beats[::4],
        "sections": {"signal": [0, 8], "plan": [8, 16], "run": [16, 28], "report": [28, 36], "muster": [36, 40]},
        "energy": [0.25, 0.3, 0.45, 0.6, 0.9, 0.9, 0.95, 1.0, 1.0, 0.4],
        "loop": True,
        "source": "hero-film/audio/score.py, synthesized on a designed grid (sample-exact)",
    }
    (FILM / "beats.json").write_text(json.dumps(grid, indent=1))
    print(f"music.wav {DUR:.1f}s, 120 bpm, {NB} beats, tail folded {tail.shape[1] / SR:.1f}s")


if __name__ == "__main__":
    main()
