#!/bin/zsh
# Draft voorbereiden vanuit een schone kopie van HEAD: geen ongecommitte bestanden, geen lokale
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
du -sh "$out" --exclude=node_modules 2>/dev/null || du -sh "$out"
echo "Klaar: $(git -C "$repo" rev-parse --short HEAD) in $out"
echo "Uploaden: cd $out && caffeine preview --json"
