# read-along

[English](README.md)

Lee en voz alta las respuestas de Claude Code y resalta, dentro del mismo mensaje, la frase que se está leyendo. Es un mod de Claude Code (un plugin con un módulo de hooks), pensado para la terminal. La interfaz está en español.

## Instalación

En el prompt de una sesión de Claude Code en la terminal:

```
/plugin install read-along --marketplace nachodd/read-along
```

Desde una terminal:

```
claude plugin install read-along --marketplace nachodd/read-along
```

Necesita Python 3.9 o superior disponible como `python3`. No hay paquetes que instalar: el motor usa solo la librería estándar.

### Mejores voces (opcional, gratis)

De entrada usa las voces del sistema (`say` en macOS). Para una voz neuronal local mucho mejor, instala [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) una sola vez (unos 340 MB, sin cuenta, 54 voces en 9 idiomas):

```
python3 <carpeta del plugin>/engine/speak.py --setup kokoro
```

También funcionan voces en la nube (Speechify, ElevenLabs, OpenAI) con tu propia API key; mira la configuración del motor más abajo.

## Uso

| | |
| --- | --- |
| `/read-along` | lee la última respuesta |
| `/read-along 3` | lee la tercera respuesta contando desde la última (como `/copy 3`) |
| `/read-along <texto>` | lee ese texto |
| `/read-along-parar` | para la lectura |
| `/read-along-idioma [auto\|es\|en]` | idioma de la voz; `auto` elige español o inglés según cada respuesta |
| `/read-along-voz [es\|en] [voz]` | lista las voces, o elige la de un idioma |
| `/read-along-velocidad [0.5–2]` | velocidad |
| `/read-along-auto [on\|off]` | lee cada respuesta al terminar el turno |
| `/read-along-estado` | proveedor, idioma, voces y velocidad |

En pantalla:

- **Debajo del prompt**: los botones `🔊 leer` / `■ parar` e `idioma: auto|ES|EN`.
- **Mientras lee**: la respuesta conserva su formato. La frase que suena se dibuja como código inline (en color), o con un `▸` adelante si ya tiene formato propio. Una banda sobre el prompt muestra el progreso, el idioma, la voz y la velocidad, con los botones **Parar** y **− / +** para la velocidad; el cambio se escucha desde la frase siguiente, sin reiniciar.
- **Al pasar el mouse sobre una respuesta** aparece un botón 🔊 que lee solo ese bloque.

Para hacer clic hace falta el modo pantalla completa de la terminal (con soporte de mouse); todas las acciones tienen también su comando.

## Cómo funciona

- `engine/speak.py` es el motor de voz de [claude-read-aloud](https://github.com/MichaelPGifford/claude-read-aloud), de Michael Gifford (MIT), incluido sin cambios: proveedores, instalación de Kokoro y reproducción por partes sin cortes.
- `engine/read_sentences.py` divide la respuesta en frases, las lee en orden (prepara la siguiente mientras suena la actual) e informa cuál está sonando.
- `hooks/register.tsx` es el mod: los comandos, los botones y el hook de render de `AssistantMessage` que marca la frase actual en el markdown original de la respuesta.

Voces, proveedor y velocidad toman por defecto la configuración de speak.py en `~/.config/claude-read-aloud/config.json`. Las opciones propias del mod (idioma, voz por idioma, velocidad, lectura automática) se guardan por cada perfil de Claude Code.

## Licencia

MIT. `engine/speak.py` es MIT, © Michael Gifford; ver `engine/LICENSE-claude-read-aloud`.
