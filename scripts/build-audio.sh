#!/usr/bin/env bash
# Copyright (c) 2026 Christopher Guindon
#
# This program and the accompanying materials are made available
# under the terms of the Eclipse Public License 2.0,
# which is available at https://www.eclipse.org/legal/epl-2.0/.
#
# SPDX-License-Identifier: EPL-2.0

# Builds public/assets/audio/*.mp3 from the CC0 Freesound sources in asset-src/audio (see docs/governance/third-party-assets.md).
# Requires ffmpeg. Sources: asset-src/audio/<name>.src.mp3 downloaded from the URLs in asset-src/audio/manifest.tsv.
set -euo pipefail
SRC=asset-src/audio
OUT=public/assets/audio
mkdir -p "$OUT"
FF="ffmpeg -v error -y"

# One-shot: trim [start, end], fade in/out, mono, peak-normalised to -1 dBFS.
oneshot() { # name start end fadeIn fadeOut [bitrate]
  local n=$1 s=$2 e=$3 fi=$4 fo=$5 br=${6:-80k}
  local d; d=$(python3 -c "print($e-$s)")
  local tmp; tmp=$(mktemp --suffix=.wav)
  $FF -i "$SRC/$n.src.mp3" -af "atrim=$s:$e,asetpts=N/SR/TB,afade=t=in:d=$fi,afade=t=out:st=$(python3 -c "print(max(0,$d-$fo))"):d=$fo" -ac 1 -ar 44100 "$tmp"
  local peak; peak=$(ffmpeg -hide_banner -i "$tmp" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB/\1/p')
  local gain; gain=$(python3 -c "print(-1.0 - ($peak))")
  $FF -i "$tmp" -af "volume=${gain}dB" -c:a libmp3lame -b:a "$br" "$OUT/$n.mp3"
  rm -f "$tmp"
}

# Seamless loop: segment [s, s+L], last X seconds crossfaded over the first X.
loop() { # name start length xfade
  local n=$1 s=$2 L=$3 X=$4
  $FF -i "$SRC/$n.src.mp3" -filter_complex "
    [0:a]atrim=$s:$(python3 -c "print($s+$L)"),asetpts=N/SR/TB,aresample=44100,asplit=3[a][b][c];
    [a]atrim=$X:$(python3 -c "print($L-$X)"),asetpts=N/SR/TB[body];
    [b]atrim=$(python3 -c "print($L-$X)"):$L,asetpts=N/SR/TB,afade=t=out:d=$X:curve=qsin[tail];
    [c]atrim=0:$X,asetpts=N/SR/TB,afade=t=in:d=$X:curve=qsin[head];
    [tail][head]amix=inputs=2:normalize=0[x];
    [body][x]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-2:LRA=11[out]" -map "[out]" -c:a libmp3lame -b:a 96k "$OUT/$n.mp3"
}

loop ambience 1 40 4
oneshot goal 2.0 10.0 0.12 2.5 96k
oneshot cheer 0.0 6.0 0.05 1.8
oneshot groan 0.9 7.0 0.1 1.5
oneshot ooh 5.9 8.0 0.04 0.5
oneshot applause 0.0 5.8 0.05 1.5
oneshot whistle_long 0.0 2.0 0.005 0.6
oneshot whistle_short 0.0 0.5 0.005 0.1
oneshot kick1 0.0 0.35 0.002 0.12
oneshot kick2 0.0 0.35 0.002 0.12
ls -l "$OUT"
