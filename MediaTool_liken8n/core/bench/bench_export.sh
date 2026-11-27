#!/bin/sh
# Đo tốc độ xuất video của engine (chạy trong container core):
#   docker compose exec -T core sh /src-bench/bench_export.sh <đường dẫn video nguồn>
# In ra thời gian và số khung/giây cho từng kịch bản, kèm mốc so sánh là FFmpeg thuần.
set -e
SRC="$1"
DUR=10
OUT=/tmp/mtbench
mkdir -p $OUT
echo "CPU: $(nproc) lõi"
# đo công bằng: xóa cache đoạn của lần trước
rm -rf "${MEDIATOOL_DATA:-/app/data}/cache/export"

video='{"id":"v","type":"video","source":"'"$SRC"'","start":0,"duration":'$DUR',"trim_start":60,"fit":"contain"}'
text='{"id":"t","type":"text","text":"Chữ nghệ thuật chạy từng chữ","start":0,"duration":'$DUR',"y":0.8,
 "style":{"size":96,"weight":900,"fill":{"type":"linear","stops":["#FFF6C2","#FFC83D","#B8860B"],"angle":90}},
 "strokes":[{"color":"#000","width":5}],"shadows":[{"color":"#000000AA","x":4,"y":6,"blur":8}],
 "animations":[{"preset":"rise","kind":"in","unit":"char","duration":1.5},{"preset":"wave","kind":"loop","unit":"char"}]}'
fx='{"id":"a","type":"adjust","start":0,"duration":'$DUR',"effects":[{"type":"teal_orange"},{"type":"vignette"},{"type":"film_grain"}]}'

run() {
  name=$1; q=$2; layers=$3
  echo '{"canvas":{"width":1920,"height":1080,"fps":30},"duration":'$DUR',"layers":['"$layers"']}' > $OUT/$name.json
  s=$(date +%s.%N)
  mediatool-render export --composition $OUT/$name.json --out $OUT/$name.mp4 --quality $q > /dev/null
  e=$(date +%s.%N)
  awk -v n="$name" -v q="$q" -v s="$s" -v e="$e" -v d=$DUR 'BEGIN { t=e-s; printf "%-22s %-8s %6.2fs  %5.1f khung/giây  (%.2f× thời gian thực)\n", n, q, t, d*30/t, d/t }'
}

s=$(date +%s.%N)
ffmpeg -v error -y -ss 60 -t $DUR -i "$SRC" -vf scale=1920:1080 -r 30 -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a aac $OUT/ffmpeg.mp4
e=$(date +%s.%N)
awk -v s="$s" -v e="$e" -v d=$DUR 'BEGIN { t=e-s; printf "%-22s %-8s %6.2fs  %5.1f khung/giây  (%.2f× thời gian thực)\n", "ffmpeg_thuan", "-", t, d*30/t, d/t }'

run video_only standard "$video"
run video_text standard "$video,$text"
run video_text_fx standard "$video,$text,$fx"
run video_text_fx_draft draft "$video,$text,$fx"
# xuất lại y nguyên: mọi đoạn lấy từ cache, chỉ còn ghép + trộn tiếng
run video_text_fx_lai standard "$video,$text,$fx"
