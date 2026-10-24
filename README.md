# read-along

[Español](README.es.md)

Read Claude Code's replies aloud, and see which sentence is being spoken, highlighted in place in the reply. Built as a Claude Code mod (a plugin with a hooks module), terminal first. The interface is in Spanish.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install read-along --marketplace nachodd/read-along
```

From a shell:

```
claude plugin install read-along --marketplace nachodd/read-along
```

Requires Python 3.9+ on your PATH as `python3`. No packages: the engine is the standard library.

### Better voices (optional, free)

Out of the box it uses your system voices (`say` on macOS). For a much better local neural voice, install [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) once (~340 MB, no account, 54 voices in 9 languages):

```
python3 <plugin folder>/engine/speak.py --setup kokoro
```

Cloud voices (Speechify, ElevenLabs, OpenAI) work too with your own API key; see the engine's config below.

## Use

| | |
| --- | --- |
| `/read-along` | read the last reply |
| `/read-along 3` | read the third reply counting back from the last (like `/copy 3`) |
| `/read-along <text>` | read that text |
| `/read-along-parar` | stop |
| `/read-along-idioma [auto\|es\|en]` | voice language; `auto` picks Spanish or English per reply |
| `/read-along-voz [es\|en] [voice]` | list voices, or pick the one for a language |
| `/read-along-velocidad [0.5–2]` | speed |
| `/read-along-auto [on\|off]` | read every reply when its turn ends |
| `/read-along-estado` | provider, language, voices, speed |

On screen:

- **Under the prompt**: `🔊 leer` / `■ parar` and `idioma: auto|ES|EN` buttons.
- **While reading**: the reply keeps its formatting; the sentence being spoken is drawn as inline code (in color), or marked with `▸` when it holds markup of its own. A band above the prompt shows progress, language, voice and speed, with **Parar** and **− / +** speed buttons; a new speed is heard from the next sentence, no restart.
- **Hovering a reply** shows a 🔊 button that reads just that block.

Clicking needs the fullscreen terminal (mouse support); every action also has its command.

## How it works

- `engine/speak.py` is the TTS engine from [claude-read-aloud](https://github.com/MichaelPGifford/claude-read-aloud) by Michael Gifford (MIT), vendored unchanged: providers, Kokoro setup, gapless chunked playback.
- `engine/read_sentences.py` splits a reply into sentences, speaks them in order (synthesising the next while the current one plays) and prints which one is playing.
- `hooks/register.tsx` is the mod: commands, the buttons, and the `AssistantMessage` render hook that marks the current sentence in the reply's own markdown.

Voices, provider and speed default from speak.py's config at `~/.config/claude-read-aloud/config.json`; the mod's own choices (language, voice per language, speed, auto-read) are kept per Claude Code profile.

## License

MIT. `engine/speak.py` is MIT, © Michael Gifford, see `engine/LICENSE-claude-read-aloud`.
