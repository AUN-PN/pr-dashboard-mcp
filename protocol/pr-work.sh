#!/bin/sh
set -eu

PROTOCOL=pr-work/1
ROOT=${PR_WORK_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/pr-work}

usage() {
  cat >&2 <<'EOF'
usage: pr-work.sh set <owner/repo#number> <working|paused|done> [--actor id] [--label text] [--note text] [--ttl minutes]
       pr-work.sh clear <owner/repo#number> [--actor id]
       pr-work.sh list [--json]

--actor defaults to $PR_WORK_ACTOR, then "user". A done record without --ttl
lasts a day. Records live in $PR_WORK_DIR
(default ${XDG_STATE_HOME:-~/.local/state}/pr-work).
EOF
  exit 2
}

die() {
  echo "pr-work: $*" >&2
  exit 1
}

json_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t\r\n' '   '
}

now_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

iso_in_minutes() {
  at=$(($(date -u +%s) + $1 * 60))
  date -u -r "$at" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$at" +%Y-%m-%dT%H:%M:%SZ
}

field() {
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1
}

number_field() {
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$1" | head -n 1
}

is_expired() {
  expires=$(field "$1" expiresAt)
  [ -n "$expires" ] && [ "$(expr "$expires" \< "$(now_iso)")" = 1 ]
}

parse_ref() {
  case $1 in
    */*#*) ;;
    *) die "expected owner/repo#number, got '$1'" ;;
  esac
  REPO=${1%%#*}
  NUMBER=${1##*#}
  OWNER=$(printf '%s' "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')
  NAME=$(printf '%s' "${REPO#*/}" | tr '[:upper:]' '[:lower:]')
  case $NUMBER in '' | *[!0-9]*) die "bad pull request number '$NUMBER'" ;; esac
  case $OWNER/$NAME in */*/* | */ | /*) die "bad repository '$REPO'" ;; esac
}

check_actor() {
  printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9._-]{0,63}$' || die "bad actor '$1' (use [a-z0-9][a-z0-9._-]*)"
}

write_record() {
  dir=$ROOT/$OWNER/$NAME/$NUMBER
  mkdir -p "$dir"
  tmp=$dir/.$ACTOR.$$.tmp
  {
    printf '{\n  "protocol": "%s",\n  "repo": "%s",\n  "number": %s,\n' "$PROTOCOL" "$(json_string "$REPO")" "$NUMBER"
    printf '  "status": "%s",\n  "actor": "%s",\n' "$STATUS" "$ACTOR"
    [ -n "$LABEL" ] && printf '  "label": "%s",\n' "$(json_string "$LABEL")"
    [ -n "$NOTE" ] && printf '  "note": "%s",\n' "$(json_string "$NOTE")"
    [ -n "$EXPIRES" ] && printf '  "expiresAt": "%s",\n' "$EXPIRES"
    printf '  "updatedAt": "%s"\n}\n' "$(now_iso)"
  } >"$tmp"
  mv -f "$tmp" "$dir/$ACTOR.json"
}

pause_other_user_work() {
  [ -d "$ROOT" ] || return 0
  find "$ROOT" -name user.json -type f | while IFS= read -r file; do
    [ "$file" = "$ROOT/$OWNER/$NAME/$NUMBER/user.json" ] && continue
    [ "$(field "$file" status)" = working ] || continue
    tmp=$file.$$.tmp
    sed -e 's/"status"[[:space:]]*:[[:space:]]*"working"/"status": "paused"/' \
      -e "s/\"updatedAt\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"updatedAt\": \"$(now_iso)\"/" "$file" >"$tmp"
    mv -f "$tmp" "$file"
  done
}

parse_options() {
  ACTOR=${PR_WORK_ACTOR:-user}
  LABEL=
  NOTE=
  TTL=
  while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || usage
    case $1 in
      --actor) ACTOR=$2 ;;
      --label) LABEL=$2 ;;
      --note) NOTE=$2 ;;
      --ttl) TTL=$2 ;;
      *) usage ;;
    esac
    shift 2
  done
  check_actor "$ACTOR"
  EXPIRES=
  if [ -n "$TTL" ]; then
    case $TTL in *[!0-9]* | 0) die "--ttl takes whole minutes" ;; esac
    EXPIRES=$(iso_in_minutes "$TTL")
  fi
}

cmd_set() {
  [ $# -ge 2 ] || usage
  parse_ref "$1"
  STATUS=$2
  shift 2
  case $STATUS in working | paused | done) ;; *) die "status must be working, paused or done" ;; esac
  parse_options "$@"
  [ "$STATUS" = done ] && [ -z "$EXPIRES" ] && EXPIRES=$(iso_in_minutes 1440)
  [ "$ACTOR" = user ] && [ "$STATUS" = working ] && pause_other_user_work
  write_record
}

cmd_clear() {
  [ $# -ge 1 ] || usage
  parse_ref "$1"
  shift
  parse_options "$@"
  rm -f "$ROOT/$OWNER/$NAME/$NUMBER/$ACTOR.json"
}

records() {
  [ -d "$ROOT" ] || return 0
  find "$ROOT" -mindepth 4 -maxdepth 4 -name '*.json' -type f | sort | while IFS= read -r file; do
    is_expired "$file" || printf '%s\n' "$file"
  done
}

cmd_list() {
  if [ "${1:-}" = --json ]; then
    records | {
      printf '['
      sep=
      while IFS= read -r file; do
        printf '%s' "$sep"
        tr -d '\n' <"$file"
        sep=,
      done
      printf ']\n'
    }
    return
  fi
  records | while IFS= read -r file; do
    printf '%s#%s\t%s\t%s\t%s\n' "$(field "$file" repo)" "$(number_field "$file" number)" \
      "$(field "$file" status)" "$(field "$file" actor)" "$(field "$file" note)"
  done
}

[ $# -ge 1 ] || usage
command=$1
shift
case $command in
  set) cmd_set "$@" ;;
  clear) cmd_clear "$@" ;;
  list) cmd_list "$@" ;;
  *) usage ;;
esac
