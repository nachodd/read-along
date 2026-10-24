#!/usr/bin/env python3
"""Speak a reply sentence by sentence and say on stdout which one is playing.

Input (stdin, JSON):  {"blocks": ["...markdown...", ...], "voice": "ef_dora", "speed": 1.0}
  (voice and speed are optional: speak.py's config fills them)
Output (stdout, one JSON object per line):
  {"control": "<path>"}                 write {"speed": n} there to change speed live
  {"items": [{"b": <block>, "p": <line>, "s": "<sentence>"}, ...]}
  {"at": <index>}                       each time a sentence starts playing
  {"done": true}

Voice, provider and speed come from speak.py's own config
(~/.config/claude-read-aloud/config.json). SIGTERM stops playback at once.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import speak as sp  # noqa: E402

LONGEST = 1500  # a sentence past this is cut, so a cloud request stays in limits
# One reading at a time (speak.py's claim() stops the last), so one control file.
CONTROL = pathlib.Path(tempfile.gettempdir()) / "claude-read-along-control.json"
# Providers whose synthesis takes the speed; the others always speak at 1x.
SPEED_AWARE = {"kokoro", "openai"}


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def sentences_of(blocks: list[str], max_chars: int) -> list[dict]:
    """Every block's sentences in order, tagged with their block; capped in all."""
    items: list[dict] = []
    for b, raw in enumerate(blocks):
        room = max_chars - sum(len(it["s"]) for it in items)
        if room <= 0:
            break
        items += [{"b": b, **it} for it in block_sentences(raw, room)]
    return items


def block_sentences(raw: str, max_chars: int) -> list[dict]:
    """Per markdown line: its prose (speak.py's cleanup), split into sentences."""
    raw = re.sub(r"```.*?```", "\n(código omitido)\n", raw, flags=re.S)
    items: list[dict] = []
    total = 0
    for p, line in enumerate(raw.splitlines()):
        prose = sp.spoken_form(line, LONGEST * 8)
        if not prose:
            continue
        for s in re.split(r"(?<=[.!?;…])\s+", prose):
            s = s.strip()
            if not s:
                continue
            for part in (sp.chunk_text(s, LONGEST, LONGEST) if len(s) > LONGEST else [s]):
                if total + len(part) > max_chars:
                    items.append({"p": p + 1, "s": "(El resto queda en pantalla.)"})
                    return items
                items.append({"p": p, "s": part})
                total += len(part)
    return items


def speed_now(cfg: dict) -> float:
    """The speed the control file asks for now; the run's own when unreadable."""
    try:
        speed = float(json.loads(CONTROL.read_text(encoding="utf-8"))["speed"])
        return min(2.0, max(0.5, speed))
    except (OSError, ValueError, KeyError, TypeError):
        return float(cfg["speed"] or 1.0)


def player_at(wav: pathlib.Path, rate: float) -> list[str]:
    """The player for a clip, sped up or slowed down by `rate` where it can be."""
    if sp.IS_MAC and abs(rate - 1.0) > 0.01:
        return ["afplay", "-r", f"{rate:.3f}", "-q", "1", str(wav)]
    return sp.player_cmd(wav)


def play_direct(items: list[dict], cfg: dict) -> None:
    """System voices (and self-playing commands): one utterance per sentence."""
    for i, it in enumerate(items):
        cfg["speed"] = speed_now(cfg)
        emit({"at": i})
        sp.speak_direct(it["s"], cfg)


def play_synth(items: list[dict], cfg: dict, synth) -> None:
    """File-based voices: synthesise sentence i+1 while sentence i plays.

    Each clip remembers the speed it was made at; a change since is made up at
    playback, so a new speed is heard from the next sentence on.
    """
    failed: list[BaseException] = []
    made_at = [1.0, 1.0]

    def fetch(text: str, slot: int) -> None:
        speed = speed_now(cfg)
        cfg["speed"] = speed
        made_at[slot] = speed if cfg["provider"] in SPEED_AWARE else 1.0
        try:
            synth(text, sp.PARTS[slot])
        except BaseException as e:  # noqa: BLE001 — surfaced after join
            failed.append(e)

    fetch(items[0]["s"], 0)
    if failed:
        raise failed[0]
    for i in range(len(items)):
        prefetch = None
        if i + 1 < len(items):
            prefetch = threading.Thread(
                target=fetch, args=(items[i + 1]["s"], (i + 1) % 2), daemon=True)
            prefetch.start()
        emit({"at": i})
        slot = i % 2
        sp._player = subprocess.Popen(
            player_at(sp.PARTS[slot], speed_now(cfg) / made_at[slot]),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **sp.quiet_win())
        sp._player.wait()
        if prefetch:
            prefetch.join()
        if failed:
            raise failed[0]


def main() -> int:
    req = json.loads(sys.stdin.read() or "{}")
    cfg = sp.load_config()

    if req.get("voice"):
        cfg["voice"] = req["voice"]
    if req.get("speed"):
        cfg["speed"] = float(req["speed"])

    items = sentences_of([b for b in req.get("blocks", []) if isinstance(b, str)],
                         int(cfg["max_chars"]))
    if not items:
        print("no hay nada para leer", file=sys.stderr)
        return 1
    CONTROL.write_text(json.dumps({"speed": float(cfg["speed"] or 1.0)}), encoding="utf-8")
    emit({"control": str(CONTROL)})
    emit({"items": items})

    # Claimed before the engine is built: a model load or an API wait is the
    # window a second reading lands in (see speak.py's claim()).
    sp.claim()
    synth = sp.make_synth(cfg)
    if synth is None:
        play_direct(items, cfg)
    else:
        play_synth(items, cfg, synth)
    sp.release()
    emit({"done": True})
    return 0


if __name__ == "__main__":
    sys.exit(main())
