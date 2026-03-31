#!/usr/bin/env python3
"""
Extract per-frame audio visualization data from an audio or video file.

Outputs JSON with RMS amplitude and frequency band data at the target FPS,
ready to embed in a HyperFrames composition.

Usage:
    python extract-audio-data.py input.mp3 -o audio-data.json
    python extract-audio-data.py input.mp4 --fps 30 --bands 16 -o audio-data.json

Requirements:
    - Python 3.9+
    - ffmpeg (for decoding audio)
    - numpy (pip install numpy)
"""

import argparse
import json
import subprocess
import sys

import numpy as np

# ---------------------------------------------------------------------------
# FFT parameters
#
# A 4096-sample window gives ~10.8 Hz per bin at 44100Hz — enough to resolve
# low-frequency bands cleanly. The per-frame audio slice (44100/30 = 1470
# samples at 30fps) is too small and causes low bands to map to the same bins.
#
# Frequency range 30Hz–16kHz covers the useful range for music. Below 30Hz is
# sub-bass most speakers can't reproduce; above 16kHz is noise/harmonics that
# don't contribute to perceived rhythm or melody.
# ---------------------------------------------------------------------------

SAMPLE_RATE = 44100
FFT_SIZE = 4096
MIN_FREQ = 30.0
MAX_FREQ = 16000.0


def decode_audio(path: str) -> np.ndarray:
    """Decode audio to mono float32 samples via ffmpeg."""
    cmd = [
        "ffmpeg", "-i", path,
        "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-loglevel", "error",
        "pipe:1",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr.decode()}", file=sys.stderr)
        sys.exit(1)
    return np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def compute_band_edges(n_bands: int) -> np.ndarray:
    """Logarithmically-spaced frequency band edges from MIN_FREQ to MAX_FREQ."""
    return np.array([
        MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (i / n_bands)
        for i in range(n_bands + 1)
    ])


def compute_fft_bands(
    windowed: np.ndarray, freq_per_bin: float, n_bins: int,
    band_edges: np.ndarray, n_bands: int,
) -> np.ndarray:
    """Compute peak magnitude in logarithmically-spaced frequency bands."""
    magnitudes = np.abs(np.fft.rfft(windowed))

    bands = np.zeros(n_bands)
    for b in range(n_bands):
        low_bin = max(0, int(band_edges[b] / freq_per_bin))
        high_bin = min(n_bins, int(band_edges[b + 1] / freq_per_bin))
        if high_bin <= low_bin:
            high_bin = low_bin + 1
        # Clamp to valid range to avoid empty slices
        low_bin = min(low_bin, n_bins - 1)
        high_bin = min(high_bin, n_bins)
        bands[b] = np.max(magnitudes[low_bin:high_bin])

    return bands


def extract(path: str, fps: int, n_bands: int) -> dict:
    """Extract per-frame audio data."""
    print(f"Decoding audio from {path}...", file=sys.stderr)
    samples = decode_audio(path)
    duration = len(samples) / SAMPLE_RATE
    frame_step = SAMPLE_RATE // fps
    total_frames = int(duration * fps)

    print(f"Duration: {duration:.1f}s, {total_frames} frames at {fps}fps", file=sys.stderr)
    print(f"FFT window: {FFT_SIZE} samples ({SAMPLE_RATE / FFT_SIZE:.1f} Hz/bin)", file=sys.stderr)
    print(f"Frequency range: {MIN_FREQ:.0f}-{MAX_FREQ:.0f} Hz, {n_bands} bands", file=sys.stderr)

    # Precompute constants
    hann = np.hanning(FFT_SIZE)
    band_edges = compute_band_edges(n_bands)
    freq_per_bin = SAMPLE_RATE / FFT_SIZE
    n_bins = FFT_SIZE // 2 + 1
    half_fft = FFT_SIZE // 2

    # Pass 1: extract raw values
    rms_values = np.zeros(total_frames)
    band_values = np.zeros((total_frames, n_bands))

    for f in range(total_frames):
        # RMS from the frame's audio slice
        rms_start = f * frame_step
        rms_end = rms_start + frame_step
        frame_slice = samples[rms_start:min(rms_end, len(samples))]
        if len(frame_slice) > 0:
            rms_values[f] = np.sqrt(np.mean(frame_slice ** 2))

        # FFT from a centered 4096-sample window
        center = rms_start + frame_step // 2
        win_start = center - half_fft
        win_end = center + half_fft

        if win_start >= 0 and win_end <= len(samples):
            window = samples[win_start:win_end] * hann
        else:
            # Zero-pad at edges
            padded = np.zeros(FFT_SIZE)
            src_start = max(0, win_start)
            src_end = min(len(samples), win_end)
            dst_start = src_start - win_start
            dst_end = dst_start + (src_end - src_start)
            padded[dst_start:dst_end] = samples[src_start:src_end]
            window = padded * hann

        band_values[f] = compute_fft_bands(window, freq_per_bin, n_bins, band_edges, n_bands)

    # Pass 2: normalize
    peak_rms = rms_values.max() if total_frames > 0 else 1.0
    if peak_rms > 0:
        rms_values /= peak_rms

    # Per-band normalization so treble is visible alongside louder bass
    band_peaks = band_values.max(axis=0)
    band_peaks[band_peaks == 0] = 1.0
    band_values /= band_peaks

    # Build output
    frames = []
    for f in range(total_frames):
        frames.append({
            "time": round(f / fps, 4),
            "rms": round(float(rms_values[f]), 4),
            "bands": [round(float(b), 4) for b in band_values[f]],
        })

    return {
        "duration": round(duration, 4),
        "fps": fps,
        "bands": n_bands,
        "totalFrames": total_frames,
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract per-frame audio visualization data")
    parser.add_argument("input", help="Audio or video file")
    parser.add_argument("-o", "--output", default="audio-data.json", help="Output JSON path")
    parser.add_argument("--fps", type=int, default=30, help="Frames per second (default: 30)")
    parser.add_argument("--bands", type=int, default=16, help="Number of frequency bands (default: 16)")
    args = parser.parse_args()

    if args.fps < 1:
        parser.error("--fps must be at least 1")
    if args.bands < 1:
        parser.error("--bands must be at least 1")

    data = extract(args.input, args.fps, args.bands)

    with open(args.output, "w") as f:
        json.dump(data, f)

    print(f"Wrote {args.output} ({data['totalFrames']} frames, {data['bands']} bands)", file=sys.stderr)


if __name__ == "__main__":
    main()
