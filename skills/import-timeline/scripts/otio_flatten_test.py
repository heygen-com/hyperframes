"""Flattener tests; skipped when `opentimelineio` is not installed."""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Windows sizes stdio to the ANSI code page (cp1252), which cannot encode every glyph a clip name or
# media path carries. Emit UTF-8 on every platform, and carry `errors` across: reconfigure() resets it
# to "strict", and CPython gives stderr "backslashreplace" so reporting an error can never itself raise.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors=_stream.errors)

try:
    import opentimelineio as otio
except ImportError:  # pragma: no cover - environment dependent
    otio = None

spec = importlib.util.spec_from_file_location("otio_flatten", Path(__file__).with_name("otio_flatten.py"))
flat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flat)

# Every result any test below produces is also checked against the published schema, so the script
# cannot emit a file the documented format (and `init --timeline`) would refuse. Skipped without
# the `jsonschema` package.
SCHEMA_FILE = Path(__file__).resolve().parents[3] / "packages" / "core" / "schemas" / "timeline-import.json"
VALIDATED = []
try:
    import jsonschema

    _validator = jsonschema.Draft202012Validator(json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))
    _flatten = flat.flatten

    def _flatten_and_validate(*args, **kwargs):
        result = _flatten(*args, **kwargs)
        errors = sorted(_validator.iter_errors(result), key=lambda e: list(e.path))
        if errors:
            raise AssertionError(
                "output does not match timeline-import.json: "
                + "; ".join(f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in errors[:3])
            )
        VALIDATED.append(result)
        return result

    flat.flatten = _flatten_and_validate
except (ImportError, OSError):  # pragma: no cover - environment dependent
    jsonschema = None


HAS_CMX3600 = otio is not None and any(
    a.name == "cmx_3600" for a in otio.plugins.ActiveManifest().adapters
)


def rt(value, rate=24):
    return otio.opentime.RationalTime(value, rate)


def tr(start, duration, rate=24):
    return otio.opentime.TimeRange(rt(start, rate), rt(duration, rate))


def media_clip(name, start, duration, url, available=(0, 1000), rate=24):
    return otio.schema.Clip(
        name=name,
        media_reference=otio.schema.ExternalReference(target_url=url, available_range=tr(*available, rate)),
        source_range=tr(start, duration, rate),
    )


def write(timeline, suffix=".otio"):
    folder = tempfile.mkdtemp()
    path = Path(folder) / f"t{suffix}"
    otio.adapters.write_to_file(timeline, str(path))
    return str(path)


@unittest.skipIf(otio is None, "opentimelineio not installed")
class FlattenTests(unittest.TestCase):
    def test_trim_gap_and_audio_lane(self):
        video = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 48, 96, "media/a.mp4"))  # 2s in, 4s long
        video.append(otio.schema.Gap(source_range=tr(0, 24)))  # 1s gap
        video.append(media_clip("b", 0, 48, "media/b.mp4"))
        audio = otio.schema.Track(name="A1", kind=otio.schema.TrackKind.Audio)
        audio.append(media_clip("m", 0, 168, "media/m.wav"))
        tl = otio.schema.Timeline(name="t", tracks=[video, audio])

        out = flat.flatten(write(tl))
        a, b, m = out["clips"]
        self.assertEqual((a["start"], a["duration"], a["mediaStart"]), (0.0, 4.0, 2.0))
        self.assertEqual((b["start"], b["duration"]), (5.0, 2.0))
        self.assertEqual((m["kind"], m["start"], m["trackIndex"]), ("audio", 0.0, 1))
        self.assertFalse(a["hasAudio"])  # separate audio track exists
        self.assertEqual(out["duration"], 7.0)
        self.assertEqual(out["fps"], {"num": 24, "den": 1})

    def test_media_start_is_the_position_on_the_sources_own_clock(self):
        # A file whose timecode starts at 1h: OTIO's source start is 1h + 10s. The converter passes
        # it through as it is and says where it believes the file starts; `init` subtracts the file's
        # own start timecode, which only the file knows.
        base = 24 * 3600
        clip = media_clip("a", base + 240, 48, "a.mp4", available=(base, 4800))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["clips"][0]["mediaStart"], 3610.0)
        self.assertEqual(out["clips"][0]["mediaOrigin"], 3600.0)
        self.assertTrue(out["clips"][0]["hasAudio"])  # no audio tracks: sound lives in the video

    def test_no_available_range_leaves_the_origin_unclaimed(self):
        # What `otiotool` leaves behind (the ALab h264 edit): a source start of 41.75 s on a
        # file that is 2.17 s long and carries timecode 00:00:41:18. Only the file can resolve it.
        clip = otio.schema.Clip(
            name="shot",
            media_reference=otio.schema.ExternalReference(target_url="shot.mov"),
            source_range=tr(1002, 52),
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        self.assertEqual((c["mediaStart"], c["mediaOrigin"]), (41.75, None))

    def test_a_window_for_an_available_range_is_passed_on_as_a_hint_only(self):
        # Resolve writes a small window around each clip; its start is not where the file starts.
        clip = media_clip("wav", 84260, 36, "take.wav", available=(84200, 100))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        self.assertAlmostEqual(c["mediaStart"], 84260 / 24, places=5)  # the position, whatever the window
        self.assertAlmostEqual(c["mediaOrigin"], 84200 / 24, places=5)  # offered as a hint

    def test_origin_hint_is_rounded_down_so_the_in_point_stays_on_its_frame(self):
        clip = media_clip("a", 10, 24, "a.mp4", rate=29.97002997, available=(1, 100))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        exact = 1 / 29.97002997
        self.assertLessEqual(c["mediaOrigin"], exact)
        self.assertLess(exact - c["mediaOrigin"], 1e-6)

    def test_a_trimmed_front_edge_moves_the_position_not_the_origin(self):
        clip = media_clip("a", 48, 48, "a.mp4", available=(24, 240))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        video.source_range = tr(12, 24)  # half a second off the front
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        self.assertEqual((c["mediaStart"], c["mediaOrigin"]), (2.5, 1.0))

    def test_time_warp_and_ntsc_rate(self):
        clip = media_clip("a", 0, 60, "a.mp4", rate=29.97002997)
        clip.effects.append(otio.schema.LinearTimeWarp(time_scalar=2.0))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["clips"][0]["playbackRate"], 2.0)
        self.assertEqual(out["fps"], {"num": 30000, "den": 1001})

    def test_ntsc_cuts_never_land_after_their_frame(self):
        # Frame 10 of 29.97 fps is 0.333667 s. A millisecond-rounded 0.334 starts the clip a frame late.
        for rate, fps in ((23.976023976, (24000, 1001)), (29.97002997, (30000, 1001)), (59.94005994, (60000, 1001))):
            video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
            video.append(media_clip("a", 0, 10, "a.mp4", rate=rate))
            video.append(media_clip("b", 7, 10, "b.mp4", rate=rate))
            out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
            self.assertEqual(out["fps"], {"num": fps[0], "den": fps[1]})
            exact_fps = fps[0] / fps[1]
            a, b = out["clips"]
            self.assertLessEqual(b["start"], 10 / exact_fps)  # the cut frame is on clip b
            self.assertEqual(a["end"], b["start"])  # no gap or overlap at the cut
            self.assertGreaterEqual(b["mediaStart"], 7 / exact_fps)  # shows source frame 7, not 6
            self.assertLess(b["mediaStart"] - 7 / exact_fps, 1e-6)
            self.assertLess(10 / exact_fps - b["start"], 1e-6)

    def test_frame_counts_stay_exact_over_a_long_ntsc_edit(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        for i in range(200):  # 200 cuts of 7 frames: drift would accumulate if cuts were chained
            video.append(media_clip(f"c{i}", 100, 7, "a.mp4", rate=29.97002997))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        for i, clip in enumerate(out["clips"]):
            self.assertLessEqual(clip["start"], 7 * i / (30000 / 1001))
            self.assertLess(7 * i / (30000 / 1001) - clip["start"], 1e-6)
        self.assertAlmostEqual(out["duration"], 1400 / (30000 / 1001), places=5)

    def test_mixed_rates_warn_and_keep_exact_times(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4", rate=24))  # 2s
        video.append(media_clip("b", 0, 60, "b.mp4", rate=30))  # 2s
        video.append(media_clip("c", 0, 30, "c.mp4", rate=30))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["fps"], {"num": 30, "den": 1})  # the most common rate
        self.assertEqual([c["start"] for c in out["clips"]], [0.0, 2.0, 4.0])
        self.assertTrue(any("mixed frame rates" in w for w in out["warnings"]))

    def test_start_rate_decides_the_composition_rate(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4", rate=24))
        video.append(media_clip("b", 0, 60, "b.mp4", rate=30))
        tl = otio.schema.Timeline(tracks=[video], global_start_time=rt(0, 24))
        out = flat.flatten(write(tl))
        self.assertEqual(out["fps"], {"num": 24, "den": 1})

    def test_transition_records_offsets_around_the_cut(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4"))
        video.append(
            otio.schema.Transition(
                transition_type=otio.schema.Transition.Type.SMPTE_Dissolve, in_offset=rt(6), out_offset=rt(12)
            )
        )
        video.append(media_clip("b", 24, 48, "b.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        (t,) = out["transitions"]
        a, b = out["clips"]
        self.assertEqual((t["from"], t["to"]), (a["id"], b["id"]))
        self.assertEqual((t["inOffset"], t["outOffset"], t["duration"], t["kind"]), (0.25, 0.5, 0.75, "dissolve"))
        # The clips themselves still meet at the cut; the importer applies the overlap.
        self.assertEqual(a["end"], b["start"])

    def test_other_transition_types_keep_their_name(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4"))
        video.append(otio.schema.Transition(transition_type="SMPTE_Wipe", in_offset=rt(6), out_offset=rt(6)))
        video.append(media_clip("b", 0, 48, "b.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["transitions"][0]["kind"], "SMPTE_Wipe")

    def test_transition_into_a_gap_is_a_fade_from_nothing(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        video.append(otio.schema.Transition(in_offset=rt(0), out_offset=rt(12)))
        video.append(media_clip("b", 0, 48, "b.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        (t,) = out["transitions"]
        self.assertEqual((t["from"], t["to"], t["outOffset"]), (None, out["clips"][0]["id"], 0.5))

    def test_transition_out_to_a_gap_is_a_fade_to_nothing(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4"))
        video.append(otio.schema.Transition(in_offset=rt(12), out_offset=rt(0)))
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        (t,) = out["transitions"]
        self.assertEqual((t["from"], t["to"]), (out["clips"][0]["id"], None))

    def test_transition_between_two_gaps_is_dropped(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        video.append(otio.schema.Transition(in_offset=rt(0), out_offset=rt(0)))
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        video.append(media_clip("a", 0, 24, "a.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["transitions"], [])

    def test_stacked_video_tracks_overlap_in_time_on_separate_lanes(self):
        v1 = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
        v1.append(media_clip("base", 0, 240, "base.mp4"))
        v2 = otio.schema.Track(name="V2", kind=otio.schema.TrackKind.Video)
        v2.append(otio.schema.Gap(source_range=tr(0, 48)))
        v2.append(media_clip("overlay", 0, 72, "overlay.png"))
        v3 = otio.schema.Track(name="V3", kind=otio.schema.TrackKind.Video)
        v3.append(otio.schema.Gap(source_range=tr(0, 72)))
        v3.append(media_clip("top", 0, 24, "top.mp4"))
        a1 = otio.schema.Track(name="A1", kind=otio.schema.TrackKind.Audio)
        a1.append(media_clip("m", 0, 240, "m.wav"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[v1, v2, v3, a1])))
        by_id = {c["label"]: c for c in out["clips"]}
        self.assertEqual([by_id[n]["trackIndex"] for n in ("base", "overlay", "top", "m")], [0, 1, 2, 3])
        self.assertEqual((by_id["overlay"]["start"], by_id["overlay"]["end"]), (2.0, 5.0))
        self.assertEqual((by_id["top"]["start"], by_id["top"]["end"]), (3.0, 4.0))
        self.assertEqual(by_id["overlay"]["kind"], "image")
        self.assertEqual(out["duration"], 10.0)

    def test_empty_track_does_not_leave_a_hole_in_the_lanes(self):
        v1 = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
        v2 = otio.schema.Track(name="V2", kind=otio.schema.TrackKind.Video)
        v2.append(media_clip("only", 0, 24, "a.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[v1, v2])))
        self.assertEqual(out["clips"][0]["trackIndex"], 0)

    def test_missing_reference_is_skipped_with_warning(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Clip(name="offline", source_range=tr(0, 24)))
        video.append(media_clip("b", 0, 24, "b.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(len(out["clips"]), 1)
        self.assertIn("offline", out["warnings"][0])

    def test_nested_stack_offsets(self):
        inner_track = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        inner_track.append(media_clip("in", 0, 24, "in.mp4"))
        nested = otio.schema.Stack(name="nest", children=[inner_track])
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4"))
        video.append(nested)
        nested.source_range = tr(0, 24)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual([c["start"] for c in out["clips"]], [0.0, 2.0])

    @unittest.skipUnless(HAS_CMX3600, "otio-cmx3600-adapter not installed")
    def test_edl_adapter(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "file:///media/a.mov"))
        path = write(otio.schema.Timeline(name="edl", tracks=[video]), ".edl")
        out = flat.flatten(path)
        self.assertEqual(out["clips"][0]["duration"], 2.0)

    def test_no_media_is_an_error(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        with self.assertRaises(ValueError):
            flat.flatten(write(otio.schema.Timeline(tracks=[video])))

    # ---- enabled flags ----

    def test_disabled_clip_and_track_are_skipped_with_a_warning(self):
        on = media_clip("on", 0, 24, "a.mp4")
        off = media_clip("off", 0, 24, "b.mp4")
        off.enabled = False
        v1 = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        v1.extend([on, off])
        hidden = otio.schema.Track(name="hidden", kind=otio.schema.TrackKind.Video)
        hidden.append(media_clip("under", 0, 24, "c.mp4"))
        hidden.enabled = False
        out = flat.flatten(write(otio.schema.Timeline(tracks=[v1, hidden])))
        self.assertEqual([c["label"] for c in out["clips"]], ["on"])
        # one for the clip, one for the track; each names what it left out
        self.assertEqual(sum("is disabled (skipped)" in w for w in out["warnings"]), 2)
        self.assertTrue(any(w.startswith('clip "off" (1.0-2.0 s) is disabled') for w in out["warnings"]))

    def test_disabled_transition_is_a_hard_cut(self):
        transition = otio.schema.Transition(in_offset=rt(6), out_offset=rt(6))
        if hasattr(transition, "enabled"):  # older OTIO releases have no flag to read
            transition.enabled = False
            video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
            video.extend([media_clip("a", 0, 48, "a.mp4"), transition, media_clip("b", 0, 48, "b.mp4")])
            out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
            self.assertEqual(out["transitions"], [])

    # ---- time effects ----

    def effect_clip(self, *effects):
        clip = media_clip("e", 24, 48, "a.mp4")
        for effect in effects:
            clip.effects.append(effect)
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        return flat.flatten(write(otio.schema.Timeline(tracks=[video])))

    def test_freeze_frame_and_zero_scalar_hold_the_clip(self):
        for effect in (otio.schema.FreezeFrame(), otio.schema.LinearTimeWarp(time_scalar=0.0)):
            (clip,) = self.effect_clip(effect)["clips"]
            self.assertTrue(clip["freeze"])
            self.assertIsNone(clip["playbackRate"])
            self.assertEqual((clip["mediaStart"], clip["duration"]), (1.0, 2.0))
            self.assertFalse(clip["hasAudio"])

    def test_stacked_time_warps_multiply(self):
        warps = [otio.schema.LinearTimeWarp(time_scalar=2.0), otio.schema.LinearTimeWarp(time_scalar=1.5)]
        self.assertEqual(self.effect_clip(*warps)["clips"][0]["playbackRate"], 3.0)

    def test_disabled_time_warp_is_ignored(self):
        warp = otio.schema.LinearTimeWarp(time_scalar=2.0)
        warp.enabled = False
        self.assertIsNone(self.effect_clip(warp)["clips"][0]["playbackRate"])

    def test_reverse_and_out_of_range_speeds_warn(self):
        reverse = self.effect_clip(otio.schema.LinearTimeWarp(time_scalar=-1.0))
        self.assertIsNone(reverse["clips"][0]["playbackRate"])
        self.assertTrue(any("reverse" in w for w in reverse["warnings"]))
        fast = self.effect_clip(otio.schema.LinearTimeWarp(time_scalar=20.0))
        self.assertEqual(fast["clips"][0]["playbackRate"], 10.0)
        self.assertTrue(any("0.1x-10x" in w for w in fast["warnings"]))
        slow = self.effect_clip(otio.schema.LinearTimeWarp(time_scalar=0.01))
        self.assertEqual(slow["clips"][0]["playbackRate"], 0.1)

    def test_other_effects_are_reported_not_silently_dropped(self):
        out = self.effect_clip(otio.schema.Effect(effect_name="Blur"))
        self.assertTrue(any('effect "Blur"' in w for w in out["warnings"]))

    # ---- trims on nested compositions ----

    def test_nested_stack_source_range_trims_and_shifts_its_clips(self):
        inner = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        inner.extend([media_clip("n1", 0, 48, "a.mp4"), media_clip("n2", 0, 48, "b.mp4")])
        nested = otio.schema.Stack(name="nest", children=[inner])
        nested.source_range = tr(24, 48)  # 1s..3s of the nested content
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("pre", 0, 24, "p.mp4"), nested])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        by = {c["label"]: c for c in out["clips"]}
        self.assertEqual((by["n1"]["start"], by["n1"]["duration"], by["n1"]["mediaStart"]), (1.0, 1.0, 1.0))
        self.assertEqual((by["n2"]["start"], by["n2"]["duration"], by["n2"]["mediaStart"]), (2.0, 1.0, 0.0))
        self.assertEqual(out["duration"], 3.0)

    def test_track_source_range_shifts_and_trims(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("x", 0, 48, "a.mp4"))
        video.source_range = tr(12, 24)  # frames 12..36 of the track, placed at time 0
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        (c,) = out["clips"]
        self.assertEqual((c["start"], c["duration"], c["mediaStart"]), (0.0, 1.0, 0.5))

    def test_top_level_stack_source_range_trims_every_track(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("long", 0, 96, "a.mp4"))
        tl = otio.schema.Timeline(tracks=[video])
        tl.tracks.source_range = tr(24, 48)
        (c,) = flat.flatten(write(tl))["clips"]
        self.assertEqual((c["start"], c["duration"], c["mediaStart"]), (0.0, 2.0, 1.0))

    def test_clip_trimmed_away_entirely_is_left_out(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("early", 0, 24, "a.mp4"), media_clip("late", 0, 24, "b.mp4")])
        video.source_range = tr(24, 24)  # only the second clip is inside
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual([c["label"] for c in out["clips"]], ["late"])

    def test_trimmed_left_edge_advances_the_source_in_point_by_rate(self):
        clip = media_clip("fast", 0, 48, "a.mp4")
        clip.effects.append(otio.schema.LinearTimeWarp(time_scalar=2.0))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        video.source_range = tr(12, 36)  # cut 0.5 s off the front
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        self.assertEqual(c["mediaStart"], 1.0)  # 0.5 s of timeline at 2x skips 1 s of source

    # ---- lanes in nested compositions ----

    def test_nested_stack_lanes_do_not_collide_with_sibling_tracks(self):
        i1 = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        i1.append(media_clip("i1", 0, 24, "a.mp4"))
        i2 = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        i2.append(media_clip("i2", 0, 24, "b.mp4"))
        outer = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        outer.append(otio.schema.Stack(children=[i1, i2]))
        sibling = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        sibling.append(media_clip("sibling", 0, 24, "c.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[outer, sibling])))
        lanes = {c["label"]: c["trackIndex"] for c in out["clips"]}
        self.assertEqual(len(set(lanes.values())), 3)
        self.assertLess(lanes["i1"], lanes["i2"])  # inner order kept
        self.assertLess(lanes["i2"], lanes["sibling"])  # whole nested stack sits under the next track

    # ---- media references ----

    def test_generated_media_is_left_empty_with_a_warning(self):
        generator = otio.schema.Clip(
            name="black", media_reference=otio.schema.GeneratorReference(generator_kind="SolidColor"), source_range=tr(0, 24)
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("ok", 0, 24, "a.mp4"), generator])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(len(out["clips"]), 1)
        self.assertIn('generated media "SolidColor"', " ".join(out["warnings"]))

    # ---- image sequences ----

    def sequence_ref(self, **kw):
        options = dict(
            target_url_base="file:///show/shot/", name_prefix="img.", name_suffix=".png", start_frame=1,
            frame_step=1, rate=24, frame_zero_padding=4, available_range=tr(0, 240),
        )
        options.update(kw)
        return otio.schema.ImageSequenceReference(**options)

    def sequence_clip(self, ref, start, duration, rate=24, effects=()):
        clip = otio.schema.Clip(name="seq", media_reference=ref, source_range=tr(start, duration, rate))
        for effect in effects:
            clip.effects.append(effect)
        return clip

    def flatten_one(self, clip, track_source_range=None, kind=None):
        video = otio.schema.Track(kind=kind or otio.schema.TrackKind.Video)
        video.append(clip)
        if track_source_range is not None:
            video.source_range = track_source_range
        return flat.flatten(write(otio.schema.Timeline(tracks=[video])))

    def library_names(self, ref, images):
        return [ref.target_url_for_image_number(i) for i in images]

    def test_sequence_clip_lists_the_image_files_it_plays_one_per_frame(self):
        ref = self.sequence_ref()
        out = self.flatten_one(self.sequence_clip(ref, 24, 48))
        (c,) = out["clips"]
        self.assertEqual((c["kind"], c["mediaStart"], c["duration"], c["hasAudio"]), ("video", 0.0, 2.0, False))
        seq = c["sequence"]
        self.assertEqual(set(seq), {"rate", "images"})  # nothing of OTIO's sequence model reaches the file
        self.assertEqual(seq["rate"], 24)
        # Images 24..71 are the files the library itself names for them, in order.
        self.assertEqual(seq["images"], self.library_names(ref, range(24, 72)))
        self.assertEqual(seq["images"][0], "file:///show/shot/img.0025.png")
        self.assertEqual(c["src"], seq["images"][0])

    def test_stepped_sequence_repeats_each_image_for_the_frames_it_covers(self):
        ref = self.sequence_ref(frame_step=2)
        (c,) = self.flatten_one(self.sequence_clip(ref, 24, 48))["clips"]
        images = c["sequence"]["images"]
        self.assertEqual(len(images), 48)  # one entry per frame of time
        expected = [name for n in self.library_names(ref, range(12, 36)) for name in (n, n)]
        self.assertEqual(images, expected)
        self.assertTrue(images[0].endswith("img.0025.png") and images[1] == images[0])

    def test_negative_start_frame_uses_the_librarys_own_names(self):
        ref = self.sequence_ref(start_frame=-24)
        (c,) = self.flatten_one(self.sequence_clip(ref, 0, 3))["clips"]
        self.assertEqual(c["sequence"]["images"], self.library_names(ref, range(0, 3)))
        self.assertTrue(c["sequence"]["images"][0].endswith("img.-0024.png"))
        self.assertTrue(c["sequence"]["images"][1].endswith("img.-0023.png"))

    def test_time_warp_plays_more_images_in_the_same_time(self):
        ref = self.sequence_ref()
        clip = self.sequence_clip(ref, 0, 24, effects=[otio.schema.LinearTimeWarp(time_scalar=2.0)])
        (c,) = self.flatten_one(clip)["clips"]
        self.assertEqual((c["duration"], len(c["sequence"]["images"]), c["playbackRate"]), (1.0, 48, 2.0))

    def test_freeze_uses_a_single_image(self):
        ref = self.sequence_ref()
        (c,) = self.flatten_one(self.sequence_clip(ref, 30, 48, effects=[otio.schema.FreezeFrame()]))["clips"]
        self.assertTrue(c["freeze"])
        self.assertEqual(c["sequence"]["images"], self.library_names(ref, [30]))

    def test_sequence_rate_can_differ_from_the_timeline_rate(self):
        ref = self.sequence_ref(rate=24)
        # One second in at the timeline's 30 fps is image 24 of a 24 fps sequence.
        (c,) = self.flatten_one(self.sequence_clip(ref, 30, 30, rate=30))["clips"]
        self.assertEqual(c["sequence"]["images"], self.library_names(ref, range(24, 48)))
        self.assertEqual(c["sequence"]["rate"], 24)

    def test_sequence_follows_trims_from_enclosing_compositions(self):
        ref = self.sequence_ref()
        (c,) = self.flatten_one(self.sequence_clip(ref, 0, 96), track_source_range=tr(12, 24))["clips"]
        self.assertEqual(c["sequence"]["images"], self.library_names(ref, range(12, 36)))

    def test_sequence_without_an_available_range_is_named_by_the_formula_and_has_no_end(self):
        # Whole-film sequences (Sparks, Sol Levante) have no range; each clip is a range into them.
        ref = self.sequence_ref(available_range=None, start_frame=0, frame_zero_padding=5)
        out = self.flatten_one(self.sequence_clip(ref, 100, 4))
        (c,) = out["clips"]
        self.assertEqual(
            c["sequence"]["images"],
            [f"file:///show/shot/img.{n:05d}.png" for n in (100, 101, 102, 103)],
        )
        self.assertFalse(any("lie past the end" in w for w in out["warnings"]))

    def test_image_names_match_the_library_wherever_it_names_them(self):
        for start, step, pad in ((1, 1, 4), (0, 1, 5), (-3, 1, 4), (10, 2, 3), (0, 1, 0)):
            ref = self.sequence_ref(start_frame=start, frame_step=step, frame_zero_padding=pad)
            for image in range(0, 6):
                self.assertEqual(flat.image_url(ref, image), ref.target_url_for_image_number(image), (start, step, pad, image))

    def test_formula_matches_the_library_when_the_library_raises(self):
        # Same references with the range removed: the fallback must give the names the library would.
        for start, step, pad in ((1, 1, 4), (-3, 1, 4), (10, 2, 3)):
            ranged = self.sequence_ref(start_frame=start, frame_step=step, frame_zero_padding=pad)
            bare = self.sequence_ref(start_frame=start, frame_step=step, frame_zero_padding=pad, available_range=None)
            for image in range(0, 6):
                self.assertEqual(flat.image_url(bare, image), ranged.target_url_for_image_number(image))

    def test_frames_past_the_end_of_a_sequence_hold_the_last_image(self):
        ref = self.sequence_ref(available_range=tr(0, 10))  # 10 images, file numbers 1..10
        out = self.flatten_one(self.sequence_clip(ref, 8, 6))
        images = out["clips"][0]["sequence"]["images"]
        self.assertEqual(len(images), 6)
        self.assertEqual(images, self.library_names(ref, [8, 9, 9, 9, 9, 9]))
        self.assertTrue(any("4 frames lie past the end" in w for w in out["warnings"]))

    def test_a_policy_of_black_is_reported_as_held(self):
        ref = self.sequence_ref(missing_frame_policy=otio.schema.ImageSequenceReference.MissingFramePolicy.black)
        out = self.flatten_one(self.sequence_clip(ref, 0, 4))
        self.assertTrue(any("asks for black" in w and "held instead" in w for w in out["warnings"]))
        self.assertNotIn("missingFramePolicy", out["clips"][0]["sequence"])

    def test_sequence_on_an_audio_track_is_skipped(self):
        ref = self.sequence_ref()
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("ok", 0, 24, "a.mp4"))
        audio = otio.schema.Track(kind=otio.schema.TrackKind.Audio)
        audio.append(self.sequence_clip(ref, 0, 24))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video, audio])))
        self.assertEqual(len(out["clips"]), 1)
        self.assertTrue(any("image sequence on an audio track" in w for w in out["warnings"]))

    def test_clip_with_no_range_is_skipped_not_fatal(self):
        bare = otio.schema.Clip(name="bare", media_reference=otio.schema.ExternalReference(target_url="a.mp4"))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([bare, media_clip("ok", 0, 24, "b.mp4")])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual([c["label"] for c in out["clips"]], ["ok"])
        self.assertTrue(any('"bare"' in w for w in out["warnings"]))

    def test_clip_without_source_range_uses_the_whole_available_range(self):
        clip = otio.schema.Clip(
            name="whole", media_reference=otio.schema.ExternalReference(target_url="a.mp4", available_range=tr(48, 72))
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        (c,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"]
        # No source range: the whole available range plays, from where that range starts.
        self.assertEqual((c["duration"], c["mediaStart"], c["mediaOrigin"]), (3.0, 2.0, 2.0))

    def test_active_media_reference_wins(self):
        clip = otio.schema.Clip(name="p", source_range=tr(0, 24))
        clip.set_media_references(
            {
                "hi": otio.schema.ExternalReference(target_url="hi.mov", available_range=tr(0, 100)),
                "proxy": otio.schema.ExternalReference(target_url="proxy.mp4", available_range=tr(0, 100)),
            },
            "proxy",
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(clip)
        self.assertEqual(flat.flatten(write(otio.schema.Timeline(tracks=[video])))["clips"][0]["src"], "proxy.mp4")

    def test_collection_imports_first_timeline_and_says_so(self):
        def timeline(name, url):
            video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
            video.append(media_clip("c", 0, 24, url))
            return otio.schema.Timeline(name=name, tracks=[video])

        collection = otio.schema.SerializableCollection(children=[timeline("one", "1.mp4"), timeline("two", "2.mp4")])
        out = flat.flatten(write(collection))
        self.assertEqual(out["clips"][0]["src"], "1.mp4")
        self.assertTrue(any("2 timelines" in w for w in out["warnings"]))

    # ---- file bundles ----

    def test_otiod_directory_bundle_gets_absolute_media_paths(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 24, "media/a.mp4"))
        folder = tempfile.mkdtemp()
        (Path(folder) / "media").mkdir()
        (Path(folder) / "media" / "a.mp4").write_bytes(b"x")
        bundle = Path(folder) / "cut.otiod"
        bundle.mkdir()
        (bundle / "media").mkdir()
        (bundle / "media" / "a.mp4").write_bytes(b"x")
        otio.adapters.write_to_file(otio.schema.Timeline(tracks=[video]), str(bundle / "content.otio"))
        out = flat.flatten(str(bundle))
        self.assertTrue(Path(out["clips"][0]["src"].replace("file://", "")).is_absolute())

    def test_otioz_bundle_is_unpacked_and_reports_its_media_root(self):
        folder = Path(tempfile.mkdtemp())
        media = folder / "a.mp4"
        media.write_bytes(b"x")
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 24, media.as_uri()))
        bundle = folder / "cut.otioz"
        otio.adapters.write_to_file(otio.schema.Timeline(tracks=[video]), str(bundle))
        target = folder / "unpacked"
        out = flat.flatten(str(bundle), extract_to=str(target))
        self.assertEqual(out["mediaRoot"], str(target))
        self.assertTrue((target / "media" / "a.mp4").exists())
        self.assertEqual(out["clips"][0]["src"], "media/a.mp4")

    # ---- reporting ----

    def test_main_prints_warnings_to_stderr_and_json_to_stdout(self):
        import contextlib
        import io
        import json

        off = media_clip("off", 0, 24, "b.mp4")
        off.enabled = False
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("on", 0, 24, "a.mp4"), off])
        path = write(otio.schema.Timeline(tracks=[video]))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = flat.main([path])
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(out.getvalue())["clips"]), 1)  # stdout is only the JSON
        self.assertIn('otio_flatten: warning: clip "off" (1.0-2.0 s) is disabled', err.getvalue())
        self.assertIn("1 clips, 2 warnings", err.getvalue())  # the skipped clip, and the empty tail it leaves

    def test_main_reports_a_failure_on_stderr_with_a_nonzero_exit(self):
        import contextlib
        import io

        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Gap(source_range=tr(0, 24)))
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            code = flat.main([write(otio.schema.Timeline(tracks=[video]))])
        self.assertEqual(code, 1)
        self.assertIn("no usable clip", err.getvalue())

    # ---- editor formats, through their OTIO adapters ----

    def adapter_roundtrip(self, adapter, suffix):
        video = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
        video.append(media_clip("one", 24, 48, "file:///media/one.mov", available=(0, 240)))
        video.append(media_clip("two", 0, 24, "file:///media/two.mov", available=(0, 240)))
        timeline = otio.schema.Timeline(name="demo", tracks=[video])
        folder = tempfile.mkdtemp()
        path = str(Path(folder) / f"edit{suffix}")
        otio.adapters.write_to_file(timeline, path, adapter_name=adapter)
        return flat.flatten(path)  # no adapter named: the file extension picks it

    def check_two_clips(self, out):
        one, two = [c for c in out["clips"] if c["kind"] == "video"]
        self.assertEqual((one["start"], one["duration"], one["mediaStart"]), (0.0, 2.0, 1.0))
        self.assertEqual((two["start"], two["duration"], two["mediaStart"]), (2.0, 1.0, 0.0))
        self.assertTrue(one["src"].endswith("one.mov") and two["src"].endswith("two.mov"))

    def installed(self, name):
        return otio is not None and any(a.name == name for a in otio.plugins.ActiveManifest().adapters)

    def test_each_installed_editor_format_flattens_through_its_adapter(self):
        tested = 0
        for adapter, suffix in (("cmx_3600", ".edl"), ("fcp_xml", ".xml"), ("fcpx_xml", ".fcpxml"), ("xges", ".xges")):
            if not self.installed(adapter):
                continue
            with self.subTest(adapter=adapter):
                out = self.adapter_roundtrip(adapter, suffix)
                self.check_two_clips(out)
                if adapter != "xges":  # the GStreamer adapter reads every file at 30 fps
                    self.assertEqual(out["fps"], {"num": 24, "den": 1})
                tested += 1
        if tested == 0:
            self.skipTest("no editor-format adapter is installed")

    def test_clip_list_formats_are_refused_with_a_reason(self):
        if not self.installed("ale"):
            self.skipTest("otio-ale-adapter not installed")
        clip = media_clip("a", 0, 24, "a.mov")
        path = str(Path(tempfile.mkdtemp()) / "log.ale")
        otio.adapters.write_to_file(otio.schema.SerializableCollection(children=[clip]), path, adapter_name="ale")
        with self.assertRaisesRegex(ValueError, "no timeline"):
            flat.flatten(path)

    # ---- the published schema ----

    @unittest.skipIf(jsonschema is None, "jsonschema not installed")
    def test_outputs_are_checked_against_the_published_schema(self):
        # The checks run inside every flatten() above; this proves they ran and can fail.
        self.assertGreater(len(VALIDATED), 20)
        validator = jsonschema.Draft202012Validator(json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))
        good = VALIDATED[0]
        self.assertEqual(list(validator.iter_errors(good)), [])
        for broken in (
            {**good, "schema": "hyperframes-timeline/2"},
            {**good, "clips": []},
            {**good, "clips": [{**good["clips"][0], "duration": 0}]},
            {**good, "clips": [{**good["clips"][0], "kind": "text"}]},
        ):
            self.assertTrue(list(validator.iter_errors(broken)))

    @unittest.skipIf(jsonschema is None, "jsonschema not installed")
    def test_every_field_the_script_writes_is_declared_in_the_schema(self):
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
        top = set(schema["properties"])
        clip = set(schema["$defs"]["clip"]["properties"])
        sequence = set(schema["$defs"]["sequence"]["properties"])
        transition = set(schema["$defs"]["transition"]["properties"])
        seen = {"top": set(), "clip": set(), "sequence": set(), "transition": set()}
        for result in VALIDATED:
            seen["top"] |= set(result)
            for c in result["clips"]:
                seen["clip"] |= set(c)
                if c["sequence"]:
                    seen["sequence"] |= set(c["sequence"])
            for t in result["transitions"]:
                seen["transition"] |= set(t)
        self.assertEqual(seen["top"] - top, set())
        self.assertEqual(seen["clip"] - clip, set())
        self.assertEqual(seen["sequence"] - sequence, set())
        self.assertEqual(seen["transition"] - transition, set())
        # and the tests exercise every clip field the schema declares, so none is declared by guesswork
        self.assertEqual(clip - seen["clip"], set())

    @unittest.skipIf(jsonschema is None, "jsonschema not installed")
    def test_output_points_at_the_schema_it_is_checked_against(self):
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 24, "a.mp4"))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["$schema"], schema["$id"])
        self.assertEqual(out["schema"], schema["properties"]["schema"]["const"])

    # ---- effects: named, grouped, and read from OTIO's data model only ----

    def one_clip(self, *effects, kind=otio.schema.TrackKind.Video, name="shot", url="a.mp4"):
        clip = media_clip(name, 0, 48, url)
        for effect in effects:
            clip.effects.append(effect)
        track = otio.schema.Track(kind=kind)
        track.append(clip)
        return flat.flatten(write(otio.schema.Timeline(tracks=[track])))

    def effect_warnings(self, out):
        return [w for w in out["warnings"] if "effect" in w]

    def test_an_effect_is_named_by_its_otio_name(self):
        out = self.one_clip(otio.schema.Effect(effect_name="Blur"))
        self.assertEqual(self.effect_warnings(out), ['clip "shot": effect "Blur" is not applied'])

    def test_a_disabled_effect_is_not_mentioned(self):
        effect = otio.schema.Effect(effect_name="Blur")
        effect.enabled = False
        self.assertEqual(self.effect_warnings(self.one_clip(effect)), [])

    def test_a_few_clips_with_the_same_effect_each_get_a_line(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        for i in range(3):
            clip = media_clip(f"c{i}", 0, 24, "a.mp4")
            clip.effects.append(otio.schema.Effect(effect_name="Blur"))
            video.append(clip)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(
            self.effect_warnings(out), [f'clip "c{i}": effect "Blur" is not applied' for i in range(3)]
        )

    def test_many_clips_with_the_same_effect_get_one_warning_with_a_count(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        for i in range(5):
            clip = media_clip(f"c{i}", 0, 24, "a.mp4")
            clip.effects.append(otio.schema.Effect(effect_name="Audio Pan"))
            video.append(clip)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(
            self.effect_warnings(out), ['effect "Audio Pan" is not applied on 5 clips; for example "c0"']
        )

    def test_different_effects_are_counted_separately(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        for i, name in enumerate(["Blur"] * 4 + ["Pan"] * 5):
            clip = media_clip(f"c{i}", 0, 24, "a.mp4")
            clip.effects.append(otio.schema.Effect(effect_name=name))
            video.append(clip)
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        warnings = self.effect_warnings(out)
        self.assertEqual(len(warnings), 2)
        self.assertIn('effect "Blur" is not applied on 4 clips', warnings[0])
        self.assertIn('effect "Pan" is not applied on 5 clips', warnings[1])

    def test_identical_warnings_are_collapsed_with_a_count(self):
        self.assertEqual(flat.collapse(["a", "b", "a", "a"]), ["a (x3)", "b"])
        self.assertEqual(flat.collapse([]), [])

    def test_an_editors_own_metadata_on_an_effect_is_not_read(self):
        # Resolve hides each effect's real name and parameters under metadata["Resolve_OTIO"]. That is
        # one editor's free-form layout, not part of OTIO's data model, so it is not interpreted: the
        # effect is reported by its OTIO name, and the faders in it do not become fades.
        faders = otio.schema.Effect(
            effect_name="Resolve Effect",
            metadata={
                "Resolve_OTIO": {
                    "Effect Name": "Video Faders",
                    "Enabled": True,
                    "Parameters": [
                        {"Parameter ID": "videoFaderIn", "Parameter Value": 25.0, "Default Parameter Value": 0.0}
                    ],
                }
            },
        )
        out = self.one_clip(faders)
        self.assertEqual(self.effect_warnings(out), ['clip "shot": effect "Resolve Effect" is not applied'])
        self.assertEqual(out["transitions"], [])

    # ---- clips that are left out: where, why, and what that does to the film's length ----

    def test_a_compound_clip_is_named_as_one_with_its_place_on_the_timeline(self):
        compound = otio.schema.Clip(
            name="picchu Compound Clip",
            media_reference=otio.core.MediaReference(name="picchu Compound Clip"),
            source_range=tr(0, 120),
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("a", 0, 48, "a.mp4"), compound])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        warning = next(w for w in out["warnings"] if "Compound" in w)
        self.assertIn('clip "picchu Compound Clip" (2.0-7.0 s)', warning)
        self.assertIn("a nested timeline or compound clip the editor did not export as a file", warning)
        self.assertNotIn("offline", warning)

    def test_an_offline_clip_says_offline_and_a_path_less_reference_says_that(self):
        offline = otio.schema.Clip(name="gone", media_reference=otio.schema.MissingReference(), source_range=tr(0, 24))
        pathless = otio.schema.Clip(
            name="blank", media_reference=otio.schema.ExternalReference(target_url=""), source_range=tr(0, 24)
        )
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("ok", 0, 24, "a.mp4"), offline, pathless])
        warnings = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["warnings"]
        self.assertTrue(any('"gone" (1.0-2.0 s)' in w and "offline" in w for w in warnings))
        self.assertTrue(any('"blank" (2.0-3.0 s)' in w and "no file path" in w for w in warnings))

    def test_a_clip_with_no_length_is_reported_not_silently_dropped(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("ok", 0, 24, "a.mp4"), media_clip("empty", 0, 0, "b.mp4")])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(len(out["clips"]), 1)
        self.assertTrue(any('"empty"' in w and "has no length" in w for w in out["warnings"]))

    def test_the_film_keeps_the_timelines_length_when_clips_at_the_end_are_skipped(self):
        gone = otio.schema.Clip(name="credits", media_reference=otio.core.MediaReference(name="credits"), source_range=tr(0, 240))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("a", 0, 48, "a.mp4"), gone])
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["duration"], 12.0)  # 2 s of picture and 10 s the timeline gives to the credits
        warning = next(w for w in out["warnings"] if w.startswith("the timeline is"))
        self.assertIn("12.0 s long but the last clip imported ends at 2.0 s", warning)
        self.assertIn("the final 10.0 s is empty", warning)
        self.assertIn('skipped there: "credits" (2.0-12.0 s:', warning)

    def test_no_length_warning_when_the_last_clip_ends_the_timeline(self):
        out = self.one_clip()
        self.assertFalse(any(w.startswith("the timeline is") for w in out["warnings"]))
        self.assertEqual(out["duration"], 2.0)

    # ---- bundles: where they unpack, and running again ----

    def bundle(self, folder, name="cut.otioz", url="file:///media/a.mp4"):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 24, url))
        path = str(Path(folder) / name)
        otio.adapters.write_to_file(otio.schema.Timeline(tracks=[video]), path)
        return path

    def test_unpacking_the_same_bundle_into_the_same_folder_twice_works(self):
        folder = Path(tempfile.mkdtemp())
        media = folder / "a.mp4"
        media.write_bytes(b"x")
        bundle = self.bundle(folder, url=media.as_uri())
        target = str(folder / "unpacked")
        first = flat.flatten(bundle, extract_to=target)
        second = flat.flatten(bundle, extract_to=target)
        self.assertEqual(first["clips"], second["clips"])
        self.assertEqual((first["mediaRoot"], second["mediaRoot"]), (target, target))
        self.assertTrue((Path(target) / "media" / "a.mp4").exists())

    def test_a_folder_that_holds_something_else_is_refused_and_left_alone(self):
        folder = Path(tempfile.mkdtemp())
        (folder / "other").mkdir()
        (folder / "other" / "mine.txt").write_text("keep", encoding="utf-8")
        media = folder / "a.mp4"
        media.write_bytes(b"x")
        bundle = self.bundle(folder, url=media.as_uri())
        with self.assertRaisesRegex(ValueError, "already holds something else"):
            flat.flatten(bundle, extract_to=str(folder / "other"))
        self.assertEqual((folder / "other" / "mine.txt").read_text(encoding="utf-8"), "keep")
        self.assertEqual(sorted(p.name for p in (folder / "other").iterdir()), ["mine.txt"])

    def test_a_folder_unpacked_from_a_different_bundle_is_refused_even_with_the_same_timeline(self):
        # Both bundles rewrite their media path to media/a.mp4, so their content.otio is identical;
        # only the media differs.
        folder = Path(tempfile.mkdtemp())
        for name, data in (("one", b"x"), ("two", b"xx")):
            (folder / name).mkdir()
            (folder / name / "a.mp4").write_bytes(data)
        first = self.bundle(folder, "one.otioz", url=(folder / "one" / "a.mp4").as_uri())
        second = self.bundle(folder, "two.otioz", url=(folder / "two" / "a.mp4").as_uri())
        target = str(folder / "shared")
        flat.flatten(first, extract_to=target)
        with self.assertRaisesRegex(ValueError, "already holds something else"):
            flat.flatten(second, extract_to=target)
        self.assertEqual((Path(target) / "media" / "a.mp4").read_bytes(), b"x")  # the first media is untouched

    def test_same_size_but_different_media_is_refused(self):
        folder = Path(tempfile.mkdtemp())
        for name, data in (("one", b"aaaa"), ("two", b"bbbb")):
            (folder / name).mkdir()
            (folder / name / "a.mp4").write_bytes(data)
        first = self.bundle(folder, "one.otioz", url=(folder / "one" / "a.mp4").as_uri())
        second = self.bundle(folder, "two.otioz", url=(folder / "two" / "a.mp4").as_uri())
        target = str(folder / "shared")
        flat.flatten(first, extract_to=target)
        with self.assertRaisesRegex(ValueError, "already holds something else"):
            flat.flatten(second, extract_to=target)
        self.assertEqual((Path(target) / "media" / "a.mp4").read_bytes(), b"aaaa")

    def test_an_edited_extracted_file_of_the_same_size_is_refused(self):
        folder = Path(tempfile.mkdtemp())
        media = folder / "a.mp4"
        media.write_bytes(b"aaaa")
        bundle = self.bundle(folder, url=media.as_uri())
        target = folder / "unpacked"
        flat.flatten(bundle, extract_to=str(target))
        (target / "media" / "a.mp4").write_bytes(b"bbbb")
        with self.assertRaisesRegex(ValueError, "already holds something else"):
            flat.flatten(bundle, extract_to=str(target))

    def test_the_default_folder_is_in_the_current_directory_not_beside_the_bundle(self):
        source = Path(tempfile.mkdtemp())
        media = source / "a.mp4"
        media.write_bytes(b"x")
        bundle = self.bundle(source, url=media.as_uri())
        work = Path(tempfile.mkdtemp())
        before = os.getcwd()
        os.chdir(work)
        try:
            out = flat.flatten(bundle)
        finally:
            os.chdir(before)
        self.assertEqual(Path(out["mediaRoot"]).resolve(), (work / "cut-media").resolve())
        self.assertTrue((work / "cut-media" / "content.otio").exists())
        self.assertFalse((source / "cut-media").exists())  # nothing written beside the bundle

    # ---- a transition that ends the track ----

    def test_a_dissolve_that_is_the_last_child_is_a_fade_out_to_nothing(self):
        # A 2 s clip, then a half-second dissolve with no trailing gap: the film must not end on a cut.
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(media_clip("a", 0, 48, "a.mp4"))
        video.append(
            otio.schema.Transition(
                transition_type=otio.schema.Transition.Type.SMPTE_Dissolve, in_offset=rt(12), out_offset=rt(0)
            )
        )
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        (t,) = out["transitions"]
        self.assertEqual((t["from"], t["to"]), (out["clips"][0]["id"], None))
        self.assertEqual((t["inOffset"], t["outOffset"], t["kind"]), (0.5, 0.0, "dissolve"))
        self.assertEqual(out["warnings"], [])

    def test_a_trailing_transition_after_a_gap_is_dropped_without_error(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("a", 0, 48, "a.mp4"), otio.schema.Gap(source_range=tr(0, 24))])
        video.append(otio.schema.Transition(in_offset=rt(6), out_offset=rt(0)))
        out = flat.flatten(write(otio.schema.Timeline(tracks=[video])))
        self.assertEqual(out["transitions"], [])

    def test_a_trailing_transition_after_a_skipped_clip_is_dropped(self):
        offline = otio.schema.Clip(name="gone", media_reference=otio.schema.MissingReference(), source_range=tr(0, 24))
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.extend([media_clip("a", 0, 24, "a.mp4"), offline, otio.schema.Transition(in_offset=rt(6), out_offset=rt(0))])
        self.assertEqual(flat.flatten(write(otio.schema.Timeline(tracks=[video])))["transitions"], [])

    def test_a_dissolve_that_starts_the_track_is_still_a_fade_in(self):
        video = otio.schema.Track(kind=otio.schema.TrackKind.Video)
        video.append(otio.schema.Transition(in_offset=rt(0), out_offset=rt(12)))
        video.append(media_clip("a", 0, 48, "a.mp4"))
        (t,) = flat.flatten(write(otio.schema.Timeline(tracks=[video])))["transitions"]
        self.assertEqual((t["from"], t["to"] is None), (None, False))


FIXTURES = Path(__file__).with_name("tests") / "fixtures"


@unittest.skipIf(otio is None, "opentimelineio not installed")
class FixtureTests(unittest.TestCase):
    """The hand-written files in tests/fixtures flatten to the committed expected JSON.

    To regenerate after an intended change, run the converter on the fixture with
    `--width 640 --height 360 --pretty` and review the diff.
    """

    def flatten_fixture(self, name):
        return flat.flatten(str(FIXTURES / name), width=640, height=360)

    def assert_matches(self, name, expected_name):
        expected = json.loads((FIXTURES / expected_name).read_text(encoding="utf-8"))
        self.assertEqual(self.flatten_fixture(name), expected)

    def test_otio_fixture_matches_its_expected_json(self):
        self.assert_matches("cut.otio", "cut.expected.json")

    @unittest.skipUnless(HAS_CMX3600, "otio-cmx3600-adapter not installed")
    def test_edl_fixture_matches_its_expected_json(self):
        self.assert_matches("cut.edl", "cut-edl.expected.json")

    def test_otio_fixture_covers_each_feature_the_import_carries(self):
        out = self.flatten_fixture("cut.otio")
        by_label = {c["label"]: c for c in out["clips"]}
        self.assertEqual(by_label["opening"]["mediaStart"], 1.0)  # a trim
        self.assertEqual(by_label["fast"]["playbackRate"], 2.0)  # a speed change
        self.assertEqual(by_label["title"]["trackIndex"], 1)  # a second lane
        self.assertEqual(len(by_label["title"]["sequence"]["images"]), 12)  # an image sequence
        self.assertEqual(by_label["music"]["kind"], "audio")
        self.assertEqual([t["kind"] for t in out["transitions"]], ["dissolve"])
        self.assertEqual(out["warnings"], [])


if __name__ == "__main__":
    unittest.main()
