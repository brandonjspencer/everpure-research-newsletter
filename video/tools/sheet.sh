#!/bin/bash
# sheet.sh <dir> <out.png> [cols] — contact sheet of t*.png stills, sorted by time, labelled
dir=$1; out=$2; cols=${3:-4}
files=$(ls $dir/t*.png | python3 -c "import sys,os;print(chr(10).join(sorted(sys.stdin.read().split(),key=lambda p:float(os.path.basename(p)[1:-4]))))")
args=(); filt=""; i=0
for f in $files; do
  args+=(-i "$f"); lab=$(basename $f .png)
  filt+="[$i:v]scale=640:360[v$i];"
  i=$((i+1))
done
n=$i; rows=$(( (n + cols - 1) / cols ))
layout=""; for ((k=0;k<n;k++)); do x=$(( (k % cols) * 640 )); y=$(( (k / cols) * 360 )); layout+="${x}_${y}|"; done
inputs=""; for ((k=0;k<n;k++)); do inputs+="[v$k]"; done
ffmpeg -v error -y "${args[@]}" -filter_complex "${filt}${inputs}xstack=inputs=$n:layout=${layout%|}:fill=white" -frames:v 1 "$out"
