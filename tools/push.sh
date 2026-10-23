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
CI=true pnpm install --frozen-lockfile
caffeine build
caffeine check
# Meetlat (M12, T19, T21): grenzen van het platform en geen geheimen in de upload.
node "$repo/tools/meetlat.mjs" "$out"
du -sh "$out" --exclude=node_modules 2>/dev/null || du -sh "$out"
echo "Klaar: $(git -C "$repo" rev-parse --short HEAD) in $out"
echo "Uploaden: cd $out && caffeine preview --json"
