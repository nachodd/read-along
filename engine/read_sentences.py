#!/usr/bin/env python3
"""Speak a reply sentence by sentence and say on stdout which one is playing.

Input (stdin, JSON):  {"blocks": ["...markdown...", ...], "voice": "ef_dora", "speed": 1.0}
  (voice and speed are optional: speak.py's config fills them)
Output (stdout, one JSON object per line):
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
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import speak as sp  # noqa: E402

LONGEST = 1500  # a sentence past this is cut, so a cloud request stays in limits


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


def play_direct(items: list[dict], cfg: dict) -> None:
    """System voices (and self-playing commands): one utterance per sentence."""
    for i, it in enumerate(items):
        emit({"at": i})
        sp.speak_direct(it["s"], cfg)


def play_synth(items: list[dict], synth) -> None:
    """File-based voices: synthesise sentence i+1 while sentence i plays."""
    failed: list[BaseException] = []

    def fetch(text: str, out: pathlib.Path) -> None:
        try:
            synth(text, out)
        except BaseException as e:  # noqa: BLE001 — surfaced after join
            failed.append(e)

    synth(items[0]["s"], sp.PARTS[0])
    for i in range(len(items)):
        prefetch = None
        if i + 1 < len(items):
            prefetch = threading.Thread(
                target=fetch, args=(items[i + 1]["s"], sp.PARTS[(i + 1) % 2]), daemon=True)
            prefetch.start()
        emit({"at": i})
        sp._player = subprocess.Popen(
            sp.player_cmd(sp.PARTS[i % 2]), stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, **sp.quiet_win())
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
    emit({"items": items})

    # Claimed before the engine is built: a model load or an API wait is the
    # window a second reading lands in (see speak.py's claim()).
    sp.claim()
    synth = sp.make_synth(cfg)
    if synth is None:
        play_direct(items, cfg)
    else:
        play_synth(items, synth)
    sp.release()
    emit({"done": True})
    return 0


if __name__ == "__main__":
    sys.exit(main())
