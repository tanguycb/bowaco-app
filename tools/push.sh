#!/bin/zsh
# Draft voorbereiden vanuit een schone kopie van HEAD (M7): geen ongecommitte bestanden, geen lokale
# testnetwerkdata (tests/net/.icp), geen sleutels. Uploaden doet daarna één expliciete opdracht.
#   zsh tools/push.sh            → bouwt in ~/.bowaco/push
#   cd ~/.bowaco/push && caffeine preview --json
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
out=${PUSHDIR:-$HOME/.bowaco/push}
rm -rf "$out"
mkdir -p "$out"
git -C "$repo" archive HEAD | tar -x -C "$out"
cd "$out"
# Versielabel (II-test punt 5): nooit meer met de hand. Draftnummer = het hoogste uit ~/.bowaco/preview-*.json + 1
# (dat schrijft `caffeine preview --json > ~/.bowaco/preview-<N>.json`), of DRAFT=<N> om het zelf te zeggen.
last=$(cat $HOME/.bowaco/preview-*.json 2>/dev/null | grep -o '"draftVersion":[0-9]*' | cut -d: -f2 | sort -n | tail -1)
draft=${DRAFT:-$(( ${last:-0} + 1 ))}
sha=$(git -C "$repo" rev-parse --short HEAD)
cfg=src/backend/lib/Config.mo
stem=$(sed -n 's/.*public let version = "\([^-"]*\).*/\1/p' "$cfg")
[[ -n "$stem" ]] || { echo "versielabel niet gevonden in $cfg"; exit 1; }
sed -i '' "s/public let version = \"[^\"]*\"/public let version = \"$stem-draft$draft $sha\"/" "$cfg"
grep -q "\"$stem-draft$draft $sha\"" "$cfg" || { echo "versielabel niet gezet"; exit 1; }
echo "Versie: $stem-draft$draft $sha"
CI=true pnpm install --frozen-lockfile
caffeine build
caffeine check
# Meetlat (M12, T19, T21): grenzen van het platform en geen geheimen in de upload.
node "$repo/tools/meetlat.mjs" "$out"
du -sh "$out" --exclude=node_modules 2>/dev/null || du -sh "$out"
echo "Klaar: $(git -C "$repo" rev-parse --short HEAD) in $out"
echo "Uploaden: cd $out && caffeine preview --json > ~/.bowaco/preview-$draft.json (draft $draft verwacht)"
