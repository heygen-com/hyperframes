#!/usr/bin/env bash
# Spike: does a nested amix (group bus) preserve the level of a flat amix?
#
# Invariant under test: a group whose FX chain is EMPTY must be a no-op on the
# mix. Grouping is routing, not processing — if grouping alone changes the
# level, every grouped export is silently wrong.
set -euo pipefail

D="$(dirname "$0")/amix-work"
rm -rf "$D"; mkdir -p "$D"
cd "$D"

SR=48000
DUR=3

# Four tracks, distinct frequencies so nothing cancels, distinct amplitudes so a
# mis-weighted track shows up rather than averaging out.
ffmpeg -v error -f lavfi -i "sine=frequency=220:sample_rate=$SR:duration=$DUR" -af "volume=0.50" -c:a pcm_s16le t1.wav
ffmpeg -v error -f lavfi -i "sine=frequency=440:sample_rate=$SR:duration=$DUR" -af "volume=0.25" -c:a pcm_s16le t2.wav
ffmpeg -v error -f lavfi -i "sine=frequency=880:sample_rate=$SR:duration=$DUR" -af "volume=0.40" -c:a pcm_s16le t3.wav
ffmpeg -v error -f lavfi -i "sine=frequency=1760:sample_rate=$SR:duration=$DUR" -af "volume=0.15" -c:a pcm_s16le t4.wav

rms () { # $1 = wav -> RMS dB
  ffmpeg -v info -i "$1" -af astats=metadata=1:reset=0 -f null - 2>&1 \
    | awk -F'dB: ' '/Overall/{o=1} o&&/RMS level dB/{print $2; exit}'
}

echo "=== per-track RMS (dB) ==="
for f in t1 t2 t3 t4; do printf "  %-4s %s\n" "$f" "$(rms $f.wav)"; done
echo

# --- ARM A: flat mix, today's shipped shape -------------------------------
# amix normalizes by input count; multiply back by the same count.
ffmpeg -v error -i t1.wav -i t2.wav -i t3.wav -i t4.wav -filter_complex \
"[0:a]apad,atrim=0:$DUR[a0];\
[1:a]apad,atrim=0:$DUR[a1];\
[2:a]apad,atrim=0:$DUR[a2];\
[3:a]apad,atrim=0:$DUR[a3];\
[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=0[mixed];\
[mixed]volume=4[out]" -map "[out]" -c:a pcm_s16le flat.wav

# --- ARM B: nested, compensated PER NODE ---------------------------------
# group A = t1+t2 (2 inputs -> x2). outer = groupA + t3 + t4 (3 inputs -> x3).
ffmpeg -v error -i t1.wav -i t2.wav -i t3.wav -i t4.wav -filter_complex \
"[0:a]apad,atrim=0:$DUR[a0];\
[1:a]apad,atrim=0:$DUR[a1];\
[2:a]apad,atrim=0:$DUR[a2];\
[3:a]apad,atrim=0:$DUR[a3];\
[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[gmix];\
[gmix]volume=2[gA];\
[gA][a2][a3]amix=inputs=3:duration=longest:dropout_transition=0[mixed];\
[mixed]volume=3[out]" -map "[out]" -c:a pcm_s16le nested_ok.wav

# --- ARM C: nested, but the outer node keeps the GLOBAL track count -------
# The plausible mistake: tracks.length is 4, the outer amix has 3 inputs.
ffmpeg -v error -i t1.wav -i t2.wav -i t3.wav -i t4.wav -filter_complex \
"[0:a]apad,atrim=0:$DUR[a0];\
[1:a]apad,atrim=0:$DUR[a1];\
[2:a]apad,atrim=0:$DUR[a2];\
[3:a]apad,atrim=0:$DUR[a3];\
[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[gmix];\
[gmix]volume=2[gA];\
[gA][a2][a3]amix=inputs=3:duration=longest:dropout_transition=0[mixed];\
[mixed]volume=4[out]" -map "[out]" -c:a pcm_s16le nested_bug.wav

# --- ARM D: nested with normalize=0, no compensation anywhere ------------
ffmpeg -v error -i t1.wav -i t2.wav -i t3.wav -i t4.wav -filter_complex \
"[0:a]apad,atrim=0:$DUR[a0];\
[1:a]apad,atrim=0:$DUR[a1];\
[2:a]apad,atrim=0:$DUR[a2];\
[3:a]apad,atrim=0:$DUR[a3];\
[a0][a1]amix=inputs=2:normalize=0:duration=longest:dropout_transition=0[gA];\
[gA][a2][a3]amix=inputs=3:normalize=0:duration=longest:dropout_transition=0[out]" \
-map "[out]" -c:a pcm_s16le nested_norm0.wav

# --- ARM E: FLAT with normalize=0 ----------------------------------------
ffmpeg -v error -i t1.wav -i t2.wav -i t3.wav -i t4.wav -filter_complex \
"[0:a]apad,atrim=0:$DUR[a0];\
[1:a]apad,atrim=0:$DUR[a1];\
[2:a]apad,atrim=0:$DUR[a2];\
[3:a]apad,atrim=0:$DUR[a3];\
[a0][a1][a2][a3]amix=inputs=4:normalize=0:duration=longest:dropout_transition=0[out]" \
-map "[out]" -c:a pcm_s16le flat_norm0.wav

echo "=== mix RMS (dB) ==="
for f in flat nested_ok nested_bug nested_norm0 flat_norm0; do
  printf "  %-14s %s\n" "$f" "$(rms $f.wav)"
done
echo

# --- sample-exactness: null test (A inverted + B must be silence) ---------
null_test () { # $1 $2 -> peak dB of the difference
  ffmpeg -v info -i "$1" -i "$2" -filter_complex \
    "[1:a]volume=-1[inv];[0:a][inv]amix=inputs=2:normalize=0,astats=metadata=1:reset=0[d]" \
    -map "[d]" -f null - 2>&1 \
    | awk -F'dB: ' '/Overall/{o=1} o&&/Peak level dB/{print $2; exit}'
}

echo "=== null tests (peak dB of difference; -inf or < -90 = identical) ==="
printf "  flat vs nested_ok     %s\n" "$(null_test flat.wav nested_ok.wav)"
printf "  flat vs nested_bug    %s\n" "$(null_test flat.wav nested_bug.wav)"
printf "  flat vs nested_norm0  %s\n" "$(null_test flat.wav nested_norm0.wav)"
printf "  flat vs flat_norm0    %s\n" "$(null_test flat.wav flat_norm0.wav)"
