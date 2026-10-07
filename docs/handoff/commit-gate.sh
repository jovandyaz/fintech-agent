#!/usr/bin/env bash
# Commits only after the staged content passes verify on Node 24 and 22 (and
# the integration suite with --int); everything else is stashed meanwhile so
# the gate sees exactly what is committed.
# usage: docs/handoff/commit-gate.sh "<subject>" [--int] files...
LOGS="${TMPDIR:-/tmp}/fintech-agent-commit-gate"
mkdir -p "$LOGS"
msg="$1"; shift; int=0; if [ "$1" = "--int" ]; then int=1; shift; fi
git add "$@" || exit 1
staged=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -n "$staged" ] && ! fnm exec --using=24 -- pnpm exec prettier --check --ignore-unknown $staged > "$LOGS/prettier.log" 2>&1; then tail -5 "$LOGS/prettier.log"; exit 1; fi
before=$(git stash list | wc -l); git stash push --keep-index --include-untracked -q -m wip; after=$(git stash list | wc -l); stashed=1; [ "$after" -gt "$before" ] && stashed=0
fnm exec --using=24 -- pnpm verify > "$LOGS/verify.log" 2>&1; rc=$?
fnm exec --using=22 -- pnpm verify > "$LOGS/verify22.log" 2>&1; rc22=$?
irc=0; if [ $int -eq 1 ]; then fnm exec --using=24 -- pnpm vitest run --project integration apps > "$LOGS/int.log" 2>&1; irc=$?; fi
[ $stashed -eq 0 ] && git stash pop -q
echo "verify24=$rc verify22=$rc22 int=$irc $(grep -E ' Tests ' "$LOGS/verify.log") $( [ $int -eq 1 ] && grep -E ' Tests ' "$LOGS/int.log")"
if [ $rc -eq 0 ] && [ $rc22 -eq 0 ] && [ $irc -eq 0 ]; then git commit -q -m "$msg" && git log --oneline -1; else grep -hE "×|error TS|✖|FAIL" "$LOGS/verify.log" "$LOGS/verify22.log" "$LOGS/int.log" 2>/dev/null | head -15; git reset -q -- "$@"; exit 1; fi
