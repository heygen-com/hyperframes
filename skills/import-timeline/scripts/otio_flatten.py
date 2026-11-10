#!/usr/bin/env python3
"""Flatten any timeline OpenTimelineIO can read into hyperframes-timeline/1 JSON.

Usage:
    otio_flatten.py <timeline-file> [--adapter NAME] [--width W --height H] [--extract-to DIR] [--pretty]

The official `opentimelineio` package does all the parsing and time math. It reads .otio
natively and any other format whose adapter plugin is installed. Tested: EDL
(`otio-cmx3600-adapter`), Final Cut Pro 7 XML (`otio-fcp-adapter`), Final Cut Pro X
(`otio-fcpx-xml-adapter`) and GStreamer (`otio-xges-adapter`). AAF (`otio-aaf-adapter`) is
untested. This script only walks the result and prints flat facts that
`hyperframes init --timeline` lays out.

Time is seconds, rounded to milliseconds. Source in-points are measured from the start of
the media, so files whose timecode starts at 01:00:00:00 map correctly.

Requires:  uv venv ~/.venvs/otio && VIRTUAL_ENV=~/.venvs/otio uv pip install opentimelineio
Run with:  ~/.venvs/otio/bin/python -I otio_flatten.py timeline.otio > timeline.json
"""

import argparse
import json
import math
import os
import re
import sys
import zipfile
import zlib
from fractions import Fraction

# Windows sizes stdio to the ANSI code page (cp1252), which cannot encode every glyph a clip name or
# media path carries. Emit UTF-8 on every platform, and carry `errors` across: reconfigure() resets it
# to "strict", and CPython gives stderr "backslashreplace" so reporting an error can never itself raise.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)

SCHEMA = "hyperframes-timeline/1"
SCHEMA_URL = "https://hyperframes.heygen.com/schema/timeline-import.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
# Broadcast rates arrive as 23.976..., 29.97... floats; snap them to their exact rationals.
NTSC = {24: Fraction(24000, 1001), 30: Fraction(30000, 1001), 60: Fraction(60000, 1001)}


def load_otio():
    try:
        import opentimelineio as otio
    except ImportError:
        sys.stderr.write(
            "opentimelineio is not installed. Install it into a venv:\n"
            "  uv venv ~/.venvs/otio && VIRTUAL_ENV=~/.venvs/otio uv pip install opentimelineio\n"
            "then run this script with ~/.venvs/otio/bin/python\n"
        )
        sys.exit(2)
    return otio


def seconds(rt):
    return rt.to_seconds()


# Times are emitted at microsecond precision, not milliseconds: a frame at 29.97 fps is 33.3667 ms,
# and rounding a cut to 0.334 s lands it a frame late, because the renderer compares each frame's
# exact time with data-start. Starts round down and source in-points round up, so a frame that
# begins at the cut is on the new clip and the source frame it shows is the right one. The small
# bias absorbs float noise on exact values such as 2.0.
def floor6(x):
    return math.floor(x * 1e6 + 1e-4) / 1e6


def ceil6(x):
    return math.ceil(x * 1e6 - 1e-4) / 1e6


def exact_fps(rate):
    for whole, ntsc in NTSC.items():
        if abs(rate - float(ntsc)) < 0.01:
            return ntsc
        if abs(rate - whole) < 1e-6:
            return Fraction(whole)
    frac = Fraction(rate).limit_denominator(1001)
    return frac


def media_src(otio, clip):
    """(url, None) for usable media, else (None, why it is skipped)."""
    ref = clip.media_reference
    if isinstance(ref, otio.schema.ExternalReference) and ref.target_url:
        return ref.target_url, None
    if isinstance(ref, otio.schema.ImageSequenceReference):
        pad = f"%0{ref.frame_zero_padding}d" if ref.frame_zero_padding else "%d"
        return f"{ref.target_url_base}{ref.name_prefix}{pad}{ref.name_suffix}", None
    if isinstance(ref, otio.schema.GeneratorReference):
        return None, f'generated media "{ref.generator_kind}" has no file, so its time is left empty'
    if type(ref) is otio.core.MediaReference:
        # Resolve exports a compound clip (a nested timeline) as a bare reference: a name, no file.
        return None, (
            f'its media is "{ref.name or clip.name}", a nested timeline or compound clip the editor '
            "did not export as a file"
        )
    if isinstance(ref, otio.schema.ExternalReference):
        return None, "its media reference has no file path"
    return None, "its media is offline in the source editor"


def media_start(clip):
    """(position of the clip's first frame on its source's own clock, the origin OTIO claims).

    The position is OTIO's `source_range` start as it is, in seconds: for a file that carries a
    timecode it is that timecode, for one that does not it is seconds into the file. `init`
    subtracts the file's own start timecode, which only the file knows. The claimed origin is the
    start of the media reference's `available_range`, or None when OTIO gives none. It is a hint,
    not a fact: Avid's export through otiotool leaves it out, and Resolve writes a small window
    around each clip, which is not where the file starts.
    """
    source = clip.source_range
    ref = clip.media_reference
    available = ref.available_range if ref is not None else None
    claimed = max(0.0, seconds(available.start_time)) if available is not None else None
    if source is None:
        return 0.0 if claimed is None else claimed, claimed
    return max(0.0, seconds(source.start_time)), claimed


def enabled(item):
    """The `enabled` flag, which older OTIO releases lack on some classes (then it is on)."""
    return getattr(item, "enabled", True)


def image_url(ref, image):
    """The URL of one image of a sequence: the library's own name for it where it can give one.

    The library names an image only from the sequence's available range, and a sequence may have none:
    the Sparks and Sol Levante examples describe a whole film as one sequence with no range and give
    each clip a range into it. Then the name is built the way the library builds it, `start_frame +
    image * frame_step`, zero-padded, a negative number written with its sign in front. Tests hold
    this to the library's names wherever the library does give one.
    """
    try:
        return ref.target_url_for_image_number(image)
    except Exception:  # noqa: BLE001 - no available range: the library cannot name any image
        frame = ref.start_frame + image * max(1, ref.frame_step)
        digits = str(abs(frame)).zfill(ref.frame_zero_padding)
        return f"{ref.target_url_base}{ref.name_prefix}{'-' if frame < 0 else ''}{digits}{ref.name_suffix}"


def sequence_of(ref, begin, consumed):
    """The image files a clip plays from an image sequence, one entry per frame, plus the rate.

    OTIO names the files (`start_frame + image * frame_step`, zero-padded, a negative number written
    with its sign in front) and says an image covers `frame_step` frames of time. All of that stays
    here: the library produces each name, and the result is a plain list the importer needs no OTIO
    rules to read. An image held for several frames is listed that many times.

    `begin` is seconds from the start of the sequence's media and `consumed` the seconds of it the clip
    plays. Returns (sequence, held): `held` counts frames past the end of the sequence, which repeat
    the last image because the library has no name for them. A sequence with no available range has no
    known end, so nothing is past it.
    """
    rate = ref.rate
    step = max(1, ref.frame_step)
    try:
        count = ref.number_of_images_in_sequence()
    except Exception:  # noqa: BLE001 - no available range: the length is unknown, so nothing is past it
        count = 0
    # No available range reads as zero images (not an error): the end is unknown, not at image -1.
    last_image = count - 1 if count > 0 else None
    # Whole frames into the sequence; the small bias keeps an exact frame boundary on its own frame.
    first_frame = math.floor(begin * rate + 1e-6)
    last_frame = math.floor((begin + max(consumed - 1.0 / rate, 0.0)) * rate + 1e-6)
    images, held = [], 0
    for frame in range(first_frame, last_frame + 1):
        image = frame // step
        if last_image is not None and image > last_image:
            image, held = last_image, held + 1
        images.append(image_url(ref, image))
    return {"rate": rate, "images": images}, held


def safe_id(name, counter):
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", name or "").strip("-")
    return f"c{counter}-{cleaned}" if cleaned else f"c{counter}"


GAP = object()  # a Gap, or the start of a track: transparent, so a transition into it is a fade
SKIPPED = object()  # a clip left out (disabled, offline, trimmed away): its transitions go with it
NESTED = object()  # a nested composition: transitions to one are not applied


class Flattener:
    def __init__(self, otio, has_audio_tracks):
        self.otio = otio
        self.has_audio_tracks = has_audio_tracks
        self.clips = []
        self.transitions = []
        self.warnings = []
        self.counter = 0
        self.rates = []
        self.max_end = 0.0
        self.dropped = []  # (label, start, end or None, why): clips left out, for the timeline-length warning
        self.effect_notes = {}  # effect name -> [clip label]
        self.black_policy = []  # clips whose sequence asks for black where an image is missing

    # ----- structure: stacks and tracks, with their trims and enabled flags -----

    def trim(self, comp, start, window):
        """Where this composition's own time 0 sits in the parent, and the visible window."""
        source = comp.source_range
        if source is None:
            return start, window
        lo, hi = window
        return (
            start - seconds(source.start_time),
            (max(lo, start), min(hi, start + seconds(source.duration))),
        )

    def composition(self, comp, start, key, window):
        otio = self.otio
        label = comp.name or type(comp).__name__
        if not enabled(comp):
            self.warnings.append(f'{type(comp).__name__.lower()} "{label}" is disabled (skipped)')
            return
        if comp.effects:
            self.warnings.append(f'{type(comp).__name__.lower()} "{label}" has effects; they are not applied')
        origin, window = self.trim(comp, start, window)
        if isinstance(comp, otio.schema.Track):
            self.track(comp, origin, key, window)
            return
        index = 0
        for child in comp:
            if isinstance(child, otio.schema.Track):
                audio = child.kind == otio.schema.TrackKind.Audio
                lane = (1 if audio else 0, index) if not key else key + (index,)
                index += 1
                self.composition(child, origin, lane, window)
            elif isinstance(child, otio.schema.Stack):
                lane = (0, index) if not key else key + (index,)
                index += 1
                self.composition(child, origin, lane, window)
            elif isinstance(child, otio.schema.Clip):
                lane = (0, index) if not key else key + (index,)
                index += 1
                self.clip(child, origin, lane, window, audio=False)

    def track(self, track, origin, key, window):
        otio = self.otio
        audio = track.kind == otio.schema.TrackKind.Audio
        previous = GAP
        pending = None
        cursor = 0.0  # items sit end to end; a transition takes no time of its own
        for child in track:
            if isinstance(child, otio.schema.Transition):
                pending = child
                continue
            place = origin + cursor
            try:
                cursor += seconds(child.duration())
            except Exception:  # noqa: BLE001 - reported by clip(); later items are placed without it
                pass
            if isinstance(child, otio.schema.Gap):
                current = GAP
            elif isinstance(child, otio.schema.Clip):
                current = self.clip(child, place, key, window, audio) or SKIPPED
            elif isinstance(child, (otio.schema.Track, otio.schema.Stack)):
                self.composition(child, place, key, window)
                current = NESTED
            else:
                continue
            if pending is not None:
                self.transition(pending, previous, current)
                pending = None
            previous = current
        if pending is not None:
            # A transition that ends the track has nothing after it: a fade out to nothing.
            self.transition(pending, previous, GAP)

    def transition(self, transition, previous, current):
        if not enabled(transition) or SKIPPED in (previous, current):
            return
        if NESTED in (previous, current):
            self.warnings.append("a transition next to a nested composition is not applied")
            return
        if previous is GAP and current is GAP:
            return
        before = ceil6(seconds(transition.in_offset))
        after = ceil6(seconds(transition.out_offset))
        kind = transition.transition_type
        self.transitions.append(
            {
                "from": None if previous is GAP else previous,
                "to": None if current is GAP else current,
                "duration": round(before + after, 6),
                "inOffset": before,
                "outOffset": after,
                "kind": "dissolve" if kind == self.otio.schema.Transition.Type.SMPTE_Dissolve else str(kind),
            }
        )

    # ----- clips -----

    def skip(self, child, place, why):
        """Leave a clip out, saying which, where on the timeline, and why."""
        label = child.name or "clip"
        try:
            end = place + seconds(child.duration())
            where = f" ({place:.1f}-{end:.1f} s)"
        except Exception:  # noqa: BLE001 - a clip with no length has no span to show
            end, where = None, ""
        self.dropped.append((label, place, end, why))
        verb = "" if why.startswith("is ") else ":"
        self.warnings.append(f'clip "{label}"{where}{verb} {why} (skipped)')

    def note_effect(self, effect, label):
        name = effect.effect_name or effect.name or type(effect).__name__
        self.effect_notes.setdefault(name, []).append(label)

    def flush_black_policy(self):
        """One warning, not one per clip: a film cut from one sequence repeats this on every clip."""
        n = len(self.black_policy)
        if n == 1:
            self.warnings.append(
                f'clip "{self.black_policy[0]}": the sequence asks for black where an image is missing; '
                "a missing image is held instead"
            )
        elif n > 1:
            self.warnings.append(
                f"{n} clips play image sequences that ask for black where an image is missing; "
                "a missing image is held instead"
            )
        self.black_policy = []

    def flush_effect_notes(self):
        """One warning per effect, not one per clip: a few get a line each, many get a count."""
        for name, labels in self.effect_notes.items():
            if len(labels) <= 3:
                for label in labels:
                    self.warnings.append(f'clip "{label}": effect "{name}" is not applied')
            else:
                self.warnings.append(
                    f'effect "{name}" is not applied on {len(labels)} clips; for example "{labels[0]}"'
                )
        self.effect_notes = {}

    def time_effects(self, clip, label):
        """(playback rate or None, freeze, the other enabled effects) from the clip's effects."""
        otio = self.otio
        rate, freeze, others = 1.0, False, []
        for effect in clip.effects:
            if not enabled(effect):
                continue
            if isinstance(effect, otio.schema.FreezeFrame):
                freeze = True
            elif isinstance(effect, otio.schema.LinearTimeWarp):
                scalar = effect.time_scalar
                if scalar == 0:
                    freeze = True
                elif scalar < 0:
                    self.warnings.append(f'clip "{label}": reverse playback is not supported (played forward)')
                else:
                    rate *= scalar
            else:
                others.append(effect)
        if freeze:
            return None, True, others
        if rate != 1.0 and not 0.1 <= rate <= 10:
            clamped = min(10.0, max(0.1, rate))
            self.warnings.append(
                f'clip "{label}": speed {rate:g}x is outside 0.1x-10x and was set to {clamped:g}x'
            )
            rate = clamped
        return (None if rate == 1.0 else rate), False, others

    def clip(self, child, place, key, window, audio):
        otio = self.otio
        label = child.name or "clip"
        if not enabled(child):
            self.skip(child, place, "is disabled")
            return None
        src, why = media_src(otio, child)
        if src is None:
            self.skip(child, place, why)
            return None
        try:
            span = child.duration()
            begin, claimed_origin = media_start(child)
        except Exception as err:  # noqa: BLE001 - a clip with no usable range must not sink the file
            self.skip(child, place, str(err))
            return None
        rate, freeze, other_effects = self.time_effects(child, label)
        if audio and freeze:
            freeze = False
            self.warnings.append(f'clip "{label}": freeze frame does not apply to audio')

        start = place
        end = place + seconds(span)
        lo, hi = window
        if end <= start:
            self.skip(child, place, "has no length")
            return None
        if end <= lo or start >= hi:
            return None  # trimmed away by an enclosing composition
        if start < lo:
            begin += 0.0 if freeze else (lo - start) * (rate or 1.0)
            start = lo
        end = min(end, hi)

        sequence = None
        ref = child.media_reference
        if isinstance(ref, otio.schema.ImageSequenceReference):
            if audio:
                self.skip(child, place, "is an image sequence on an audio track")
                return None
            played = 1.0 / ref.rate if freeze else (end - start) * (rate or 1.0)
            try:
                sequence, held = sequence_of(ref, max(0.0, begin - (claimed_origin or 0.0)), played)
            except Exception as err:  # noqa: BLE001 - e.g. no available range, so no image can be named
                self.skip(child, place, f"cannot name its sequence images: {err}")
                return None
            if held:
                self.warnings.append(
                    f'clip "{label}": {held} frames lie past the end of its image sequence; '
                    "the last image is held"
                )
            if ref.missing_frame_policy == otio.schema.ImageSequenceReference.MissingFramePolicy.black:
                self.black_policy.append(label)
            src = sequence["images"][0]  # a name for the clip's media; the images carry the content
            begin = 0.0  # the importer encodes the sequence from this clip's first image
            claimed_origin = None
        self.counter += 1
        clip_id = safe_id(child.name, self.counter)
        ext = os.path.splitext(src.split("?", 1)[0])[1].lower()
        kind = "audio" if audio else ("image" if ext in IMAGE_EXTENSIONS and sequence is None else "video")
        if kind == "image":
            begin, claimed_origin = 0.0, None
        self.rates.append(span.rate)
        self.max_end = max(self.max_end, end)
        self.clips.append(
            {
                "id": clip_id,
                "label": child.name or None,
                "kind": kind,
                "start": floor6(start),
                "duration": floor6(end - start),
                "end": floor6(end),
                "trackIndex": key,
                "src": src,
                "mediaStart": ceil6(begin),
                # Rounded down: `init` subtracts it, and a smaller origin keeps the in-point on its frame.
                "mediaOrigin": None if claimed_origin is None else floor6(claimed_origin),
                "volume": None,
                "playbackRate": rate,
                "freeze": freeze,
                "sequence": sequence,
                # A video-only track means the editor kept sound inside the video file.
                "hasAudio": kind == "video" and not freeze and sequence is None and not self.has_audio_tracks,
            }
        )
        for effect in other_effects:
            self.note_effect(effect, label)
        return clip_id


def collapse(warnings):
    """Identical warnings once, with a count, in the order they first appeared."""
    counts = {}
    for warning in warnings:
        counts[warning] = counts.get(warning, 0) + 1
    return [w if n == 1 else f"{w} (x{n})" for w, n in counts.items()]


def crc32_of(path):
    """CRC-32 of a file, read in chunks, comparable with the one a zip entry records."""
    crc = 0
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            crc = zlib.crc32(chunk, crc)
    return crc


def unpack_bundle(path, extract_to):
    """Unpack an .otioz bundle and return (the folder its media sits in, the content file to read).

    The default folder is `<name>-media` in the current directory, not beside the bundle: a bundle
    is often a download, and writing next to it puts gigabytes into the folder it came from.

    A folder this bundle was already unpacked into is reused, so running again works. "Already
    unpacked" means every file in the bundle is there with the same size and the same CRC-32 the
    bundle records for it (size alone passes swapped media of equal length): two bundles can share an
    identical `content.otio` (every media path in it is rewritten to `media/<name>`) and still hold
    different media, so the timeline alone cannot say. A folder that holds anything else is
    refused, because unpacking over it would mix two sets of media.
    """
    folder = os.path.abspath(
        extract_to or os.path.join(os.getcwd(), os.path.splitext(os.path.basename(path))[0] + "-media")
    )
    with zipfile.ZipFile(path) as bundle:
        entries = [entry for entry in bundle.infolist() if not entry.is_dir()]
        if os.path.isdir(folder) and os.listdir(folder):
            def present(entry):
                target = os.path.join(folder, entry.filename)
                return (
                    os.path.isfile(target)
                    and os.path.getsize(target) == entry.file_size
                    and crc32_of(target) == entry.CRC
                )

            if all(present(entry) for entry in entries):
                return folder, os.path.join(folder, "content.otio")  # already unpacked from this bundle
            raise ValueError(
                f"{folder} already holds something else; give --extract-to a new or empty folder"
            )
        os.makedirs(folder, exist_ok=True)
        bundle.extractall(folder)
    return folder, os.path.join(folder, "content.otio")


def pick_fps(flattener, timeline):
    """The composition rate: the timeline's own start rate, else the most common clip rate."""
    exact = [exact_fps(r) for r in flattener.rates] or [Fraction(24)]
    start = timeline.global_start_time
    chosen = exact_fps(start.rate) if start is not None else max(set(exact), key=exact.count)
    others = sorted({float(r) for r in exact if r != chosen})
    if others:
        flattener.warnings.append(
            f"clips use mixed frame rates ({', '.join(f'{r:g}' for r in [float(chosen)] + others)}); "
            f"the composition runs at {float(chosen):g} fps, so cuts on the other rates are placed "
            "at their exact time and may fall between frames"
        )
    return chosen


def flatten(path, adapter=None, width=None, height=None, extract_to=None):
    otio = load_otio()
    suffix = os.path.splitext(path)[1].lower()
    options = {}
    media_root = None
    if suffix == ".otioz":
        # A bundle's media sits beside its content.otio; unpack it so the paths resolve.
        media_root, path = unpack_bundle(path, extract_to)
        adapter = "otio_json"
    elif suffix == ".otiod":
        options["absolute_media_reference_paths"] = True
    timeline = otio.adapters.read_from_file(path, adapter_name=adapter, **options)
    notes = []
    if isinstance(timeline, otio.schema.SerializableCollection):
        timelines = [t for t in timeline if isinstance(t, otio.schema.Timeline)]
        if not timelines:
            raise ValueError(
                "file contains no timeline (a clip list such as an ALE log has clips but no edit to import)"
            )
        if len(timelines) > 1:
            notes.append(
                f'file holds {len(timelines)} timelines; imported "{timelines[0].name}" and left the rest'
            )
        timeline = timelines[0]
    if not isinstance(timeline, otio.schema.Timeline):
        raise ValueError(f"expected a Timeline, found {type(timeline).__name__}")
    stack = timeline.tracks

    has_audio = any(
        t.kind == otio.schema.TrackKind.Audio for t in stack if isinstance(t, otio.schema.Track)
    )
    flattener = Flattener(otio, has_audio)
    flattener.warnings.extend(notes)
    flattener.composition(stack, 0.0, (), (-math.inf, math.inf))
    if not flattener.clips:
        detail = "; ".join(flattener.warnings[:3])
        raise ValueError("no usable clip was found" + (f" ({detail})" if detail else ""))

    # Lanes were keyed by their place in the nesting; number them 0.. in that order (video, then audio).
    lanes = sorted({c["trackIndex"] for c in flattener.clips})
    remap = {lane: i for i, lane in enumerate(lanes)}
    for c in flattener.clips:
        c["trackIndex"] = remap[c["trackIndex"]]

    fps = pick_fps(flattener, timeline)
    flattener.flush_effect_notes()
    flattener.flush_black_policy()

    # The film keeps the timeline's length. When clips were left out at the end (an offline compound
    # clip, say) the render would otherwise be shorter than the film, and out of step with anything
    # cut to it; the time they held stays, empty, and the warning says what was skipped there.
    try:
        timeline_end = seconds(timeline.duration())
    except Exception:  # noqa: BLE001 - no usable range anywhere: nothing to compare with
        timeline_end = None
    duration = flattener.max_end
    if timeline_end is not None and timeline_end - flattener.max_end > 1.0 / float(fps):
        duration = timeline_end
        lost = [d for d in flattener.dropped if d[2] is not None and d[2] > flattener.max_end + 1e-6]
        names = ", ".join(f'"{label}" ({start:.1f}-{end:.1f} s: {why})' for label, start, end, why in lost[:3])
        flattener.warnings.append(
            f"the timeline is {timeline_end:.1f} s long but the last clip imported ends at "
            f"{flattener.max_end:.1f} s, so the final {timeline_end - flattener.max_end:.1f} s is empty"
            + (f"; skipped there: {names}" if names else "")
        )
    flattener.warnings = collapse(flattener.warnings)
    return {
        "$schema": SCHEMA_URL,
        "schema": SCHEMA,
        "fps": {"num": fps.numerator, "den": fps.denominator},
        "width": width,
        "height": height,
        "duration": round(duration, 6),
        "mediaRoot": media_root,
        "clips": flattener.clips,
        "transitions": flattener.transitions,
        "warnings": flattener.warnings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("timeline")
    parser.add_argument("--adapter", help="OTIO adapter name (default: guessed from the file extension)")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--extract-to", help="Where to unpack an .otioz bundle (default: <name>-media next to it)")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    if (args.width is None) != (args.height is None):
        parser.error("--width and --height go together")
    try:
        result = flatten(args.timeline, args.adapter, args.width, args.height, args.extract_to)
    except Exception as err:  # noqa: BLE001 - report any adapter failure as one line
        sys.stderr.write(f"otio_flatten: {err}\n")
        return 1
    json.dump(result, sys.stdout, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    # stdout is the JSON, so a person running this by hand sees the warnings here.
    for warning in result["warnings"]:
        sys.stderr.write(f"otio_flatten: warning: {warning}\n")
    sys.stderr.write(
        f"otio_flatten: {len(result['clips'])} clips, {len(result['warnings'])} warnings"
        " (also in the JSON; `init --timeline` prints them again)\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
