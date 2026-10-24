# Muster: shot list
20 s loop · 120 bpm · 40 beats · format: 16x9 (1920x1080)
Music: bespoke `audio/score.py` (E minor, SIGNAL → PLAN → RUN → REPORT → MUSTER) · VO: none

Brand: paper #F2F3F0, ink #121413, one accent signal #FF5A1F. Display = Instrument Sans, UI = Geist Mono.
Every screen is a real capture in `assets/shots/` (demo server, exercise "Encrypted file server, Lyon office").

| # | beats | time | shot | on screen (asset) | motion | out (transition) | sound (hits) |
|---|-------|------|------|-------------------|--------|------------------|--------------|
| 1 | 0-4 | 0.0-2.0 | Hook: the alert | Pure type on paper: "Ransom note" / "on FS-LYON-02." (the analyst's own note in the product). Mono run clock `00:00:0x` top-left. Accent dot = the brand dot | Words drop in per beat, heavy spring; first word already landing on frame 0; dot pulses on each heartbeat (b0, b2) | Type lifts out upward; the dot travels down-right and becomes the start node of the flowchart (match on the dot) | heartbeat bed, tick @0, thud @1, pop @2 |
| 2 | 4-8 | 2.0-4.0 | Draw the response | `canvas-zoom.png`: the real Ransomware graph (black decision hexagons, red escalation) | Camera dollies down the graph in log space: decision → escalation (red, b5) → "Clean backups available?" (b6); caption "Draw the response." slides in from left | At b7.5 pull back fast: the canvas shrinks into its place inside the full editor | whoosh @5, click @6, whoosh @7.5 |
| 3 | 8-12 | 4.0-6.0 | Edit, own, time | `editor-selected.png` full editor, then a push to `inspector.png` (S03 Isolate affected hosts: owner L2 Analyst, SLA 5 min, checklist) | Editor lands (gentle spring, slight settle); b10 push right into the inspector; checklist rows stagger in by mask (real rows) | Inspector slides left as history slides in (whip, both on screen) | thud @8, tick ×4 @10-11.5 |
| 4 | 12-16 | 6.0-8.0 | Versioned | `history.png` left list + `diff-graph.png` (green added / amber changed nodes) | Words "Versioned." "Diffed." "Approved." land on b12, b13, b14 over the diff; diff graph slides up under them; riser to b16 | Snap zoom into the run clock region of the next shot | pop @12/13/14, riser → 16 |
| 5 | 16-20 | 8.0-10.0 | DROP: run it live | `run-step.png` (clock 00:02:30, NIST phase rail, Triage the alert) → `step-card.png` | Impact on 16: full run view lands; b18 push in on the step card (log zoom), checked tasks revealed row by row | Step card slides up out, decision card slides up in (vertical whip) | impact @16, click @18, tick @18.5/19 |
| 6 | 20-24 | 10.0-12.0 | The decision | `decision-card.png` "Encryption in progress?" YES / NO | Title sets in large; YES card springs forward on b22 with an accent outline; b23 push through YES | Push through the YES card into the timeline | thud @20, blip @22, whoosh @23.5 |
| 7 | 24-28 | 12.0-14.0 | On the clock | `timeline.png` (real timeline rows with timestamps, by whom) | Rows slide in from the right one per half beat; caption "Every action on the clock." | Whoosh: report sheet rises from below over it | tick per row @24-26.5, whoosh @27.5 |
| 8 | 28-32 | 14.0-16.0 | LIFT: the report writes itself | `sheet.png` (5482 px tall incident report: exec summary, timeline, SLAs, notes) | Crash on 28: sheet rises and keeps panning up its own length (slow constant dolly); caption "The report writes itself." | PDF page drops in over it on b32 | crash @28, tick @30 |
| 9 | 32-36 | 16.0-18.0 | Yours, light or dark | `pdf-1.png` lands (b32) + `picker.png` slides in beside it (b33); b34 `library.png` → `library-dark.png` split wipe | Picker pops with bouncy spring; diagonal wipe line sweeps light → dark library; caption "10 playbooks on day one." | Everything clears up and out on b35.75 to paper | thud @32, pop @33, whoosh @34, riser → 36 |
| 10 | 36-40 | 18.0-20.0 | END CARD | The Muster mark (M path + accent dot, the product's own logo), wordmark "Muster", line "Know the next step before the incident." (the product's sign-in copy), mono "Incident response playbooks · self-hosted" | Impact on 36: M strokes draw on, dot drops in on 36.5, wordmark glyphs spring; line on 37; holds ≥ 1.5 s; b39.5 type lifts out leaving paper | Loop seam: paper → frame 0 (first word landing) | impact @36, bell @36.5, tick @37 |

Formats: 16x9 only (brief).

Longest gap without a new event: beats 28-30 (1.0 s), with the pan running through it.
Loop: the last half beat is paper with type leaving upward; frame 0 is paper with type arriving, and
the score's tail is folded onto its head, so the seam has neither a visual nor an audible gap.
