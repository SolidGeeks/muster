# Muster hero: critique log

Scores 1-10: hook · phone readability · motion · variety · brand accuracy · sound sync.

## Round 1 (first full contact sheet)
Scores: 6 · 5 · 6 · 8 · 8 · 7
Worst three:
1. Frame 0 showed squashed, half-landed glyphs ("Ransom no..."): the hook didn't read.
2. Product cards too small: the whole 3200 px editor and history at 0.36x were unreadable texture.
3. Push-through on YES (40x zoom) smeared the button border into grey stripes on the downbeat at b24;
   end card on b36 showed an empty frame.
Fixes: glyph springs start at -0.7 with no vertical squash; editor cropped to canvas + inspector;
push-through replaced by a vertical whip; end card springs start at 35.8.

## Round 2
Scores: 7 · 7 · 7 · 8 · 9 · 8
Worst three:
1. Captions started after the downbeat, so every cut's first frame had an empty caption column.
2. History shot still tiny and empty (diff graph mostly dotted canvas).
3. PDF landed mid-whip at b32, blurred on the downbeat.
Fixes: captions lead each cut by 0.3-0.5 beat so they travel in with the whip; history rebuilt as the
real compare bar (counters underlined on Versioned / Diffed / Approved) over the change list at 0.6x;
PDF spring moved to 31.55.

## Round 3
Scores: 8 · 8 · 8 · 9 · 9 · 8
Checked: strips across all eight whips (both shots on screen, new image on the beat), loop seam
(end card holds 18.2-19.7 s, exits to paper, frame 0 is the landed hook), SFX onsets vs hits.json
(26/29 within 25 ms; the three outliers sit under the impact's tail and the frame-0 edge).
Fixed this round: the decision shot was static for 4 beats (now a slow log push-in plus the YES
outline on 22); timeline rows begin at 24.2 so the downbeat frame isn't an empty card.

Remaining, named:
- UI microcopy inside the screenshots is not readable on a phone (captions are). Fine for a desktop
  hero; a 9:16 cut would need tighter crops.
- The score was checked by spectrogram, loudness and onset analysis only; it hasn't been auditioned
  by ear in this environment.
- mix.mjs fades the last 0.3 s, so with sound on the loop restarts on the frame-0 thud rather than
  running through seamlessly. The site plays the video muted, where the seam is clean.
