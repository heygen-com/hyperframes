#!/bin/zsh
# Pre-grades every B-roll range used in match_table.json into edit/assets/broll/<id>.mp4 at 1920x960.
set -e
cd "${0:A:h}"
SRC=".."
OUT="assets/broll"
mkdir -p "$OUT"

# Palette-mapped grades: luminance -> #0A0A0A..#F2EFE8 (bw) or #0A0A0A..#D7261E..#F2EFE8 (crimson).
BW="format=gray,format=rgb24,curves=r='0/0.04 0.5/0.47 1/0.95':g='0/0.04 0.5/0.46 1/0.94':b='0/0.04 0.5/0.45 1/0.91'"
CRIMSON="format=gray,format=rgb24,curves=r='0/0.04 0.45/0.84 1/0.95':g='0/0.04 0.45/0.15 1/0.94':b='0/0.04 0.45/0.12 1/0.91'"
FINISH="eq=contrast=1.12,vignette=angle=PI/4.2,noise=alls=7:allf=t,format=yuv420p"

land() { # id file in dur grade [prefilter]
  ffmpeg -v error -y -ss "$3" -t "$4" -i "$SRC/$2" -an \
    -vf "${6:+$6,}crop=1280:640:0:40,scale=1920:960:flags=lanczos,$5,$FINISH" \
    -r 30 -c:v libx264 -crf 19 -preset medium -movflags +faststart "$OUT/$1.mp4"
}

vert() { # id file in dur grade
  ffmpeg -v error -y -ss "$3" -t "$4" -i "$SRC/$2" -an -filter_complex \
    "[0:v]split[a][b];[a]scale=1920:-2,crop=1920:960,boxblur=40:2,eq=brightness=-0.18[bg];[b]scale=-2:960:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0,$5,$FINISH" \
    -r 30 -c:v libx264 -crf 19 -preset medium -movflags +faststart "$OUT/$1.mp4"
}

land chart      "Downward_trending_line_chart_20260928160944.mp4"          0.3 5.8 "$CRIMSON" "gblur=sigma=3.2"
vert scroll     "Man_scrolling_phone_20260928160318.mp4"                   0.5 3.2 "$BW"
vert corridor   "Man_walking_down_corridor_20260928160256.mp4"             0.0 1.9 "$BW"
vert pacing     "Man_pacing_on_phone_call_20260928160249.mp4"              0.3 2.2 "$BW"
land pathway    "Glass_pathway_crumbling_into_dust_20260928161057.mp4"     2.3 2.65 "$CRIMSON" "setpts=PTS/0.64"
land wireframes "Wireframes_transforming_into_cry…_20260928161030.mp4"     1.0 5.3 "$BW"
land messaging  "Messaging_interface_card_flies_u…_20260928161025.mp4"     2.5 2.3 "$BW"
land panels     "Glass_panels_slide_open_deck_20260928161044.mp4"          2.4 1.9 "$BW"
land cards      "Cards_uploading_into_glass_conta…_20260928161010.mp4"     0.2 2.0 "$BW"
land launchpad  "Digital_glass_launchpad_platform…_20260928160937.mp4"     0.5 3.6 "$BW"
land nodes      "Glass_nodes_forming_agency_network_20260928161001.mp4"    0.5 4.9 "$BW"
ls -la "$OUT"
