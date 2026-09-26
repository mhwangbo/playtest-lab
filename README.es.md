[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | **Español**

# playtest-lab

_Esta es una traducción. Si difiere del README en inglés, prevalece la versión en inglés._

[![ci](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml)

**Un grupo de playtest para tu juego: bots jugadores, personas de IA que prueban el juego y un informe priorizado.**
Hoy funciona con juegos web, Unity y Godot. Es una skill de [Claude Code](https://claude.com/claude-code) y también una CLI de Node sin dependencias.

Responde a dos preguntas distintas, con un coste bajo:

| Pregunta | Quién la responde | Coste |
|---|---|---|
| **¿Está roto o desequilibrado?** Cuelgues, bloqueos (softlocks), curva de dificultad, gradiente de habilidad, estrategias dominantes | **Bots**: sin interfaz gráfica, deterministas, miles de partidas | gratis (CPU) |
| **¿Se entiende? ¿Es divertido?** Onboarding, confusión, sensación de juego, "¿volvería a jugar?" | **Personas**: playtesters de IA que juegan la build real, con una rúbrica y crítica obligatoria | unos $0.40–1.30 por sesión |

Ambos escriben en un único informe versionado: `playtest-report.json` más `report.md`. Contiene problemas priorizados, un ticket sugerido para cada problema y tablas por nivel.

---

## Qué incluye

- **Ejecutor de bots** (`lab/bots.js`)
  - Juega tu juego a través de un pequeño **adaptador** sobre muchas semillas, con políticas inactiva (idle), aleatoria y tus propias políticas de habilidad.
  - Agrega métricas como media y p10/p50/p90.
  - Reporta cuelgues y partidas que nunca terminan como problemas P0/P1, y admite tus propias alarmas de balance.
- **Puente con el motor** (`playtest-bridge/1`)
  - JSON delimitado por saltos de línea sobre localhost.
  - El juego avanza **solo** cuando el lab pide fotogramas, con un paso de tiempo fijo, así que las partidas son **deterministas por semilla**.
  - Se distribuye como paquete de **Unity** y como addon de **Godot**.
- **Personas**, que juegan builds reales:
  - **Web (live-lite):** se inyecta un harness en la página. El juego corre sobre un reloj simulado (congelado entre turnos y acelerado durante ellos), la persona actúa con verbos de jugador y percibe el texto en pantalla más una descripción de la escena de "fidelidad humana", con cantidades deliberadamente vagas y sin lenguaje de causa y efecto. Recibe capturas de pantalla durante los primeros 60 s.
  - **Builds de motor:** `lab.js host` lanza la build en una ventana. La persona actúa con comandos simples (`play tap Play`, `play drag B --to 2,1`, `play shot`). Los juegos de Unity con uGUI lo obtienen **sin escribir código** (`-playtestUgui`).
  - **Rúbrica:** cada persona debe puntuar la claridad a los 10 s y a los 60 s, la agencia, la tensión, la recompensa y la rejugabilidad, y debe nombrar sus 3 momentos de mayor duda. Los problemas deben quedar registrados, no basta con afirmarlos.
- **Generador de informes**
  - Los problemas reportados por personas quedan como **no verificados**, y fuera del veredicto, hasta que alguien los reproduzca.
  - Los hallazgos de los bots cuentan de inmediato porque se reproducen por semilla.
- **Integración opcional con [ai-game-studio](https://github.com/mhwangbo/ai-game-studio)**
  - Replica los resúmenes en el chat `#qa` del estudio.
  - La puerta de playtest del estudio convierte los `suggestedTicket`s en tickets.
  - Se desactiva con `integrations.gameStudio: "off"`.

## Motores compatibles

| Motor | Bots | Personas | Cómo |
|---|---|---|---|
| **Web** (JS/TS, Canvas, Phaser, …) | ✅ | ✅ live-lite | el adaptador importa tu simulación sin DOM · `lab.js serve` inyecta el harness |
| **Unity** | ✅ | ✅ (uGUI sin código, o tu propio target) | `engines/unity/com.playtestlab.bridge` (UPM) |
| **Godot 4** | ✅ | ✅ (implementa observe/act; las capturas necesitan una ventana) | `engines/godot/addons/playtest_bridge` |
| Núcleos por turnos / de puzles | ✅ (ejecutor en el motor + `bots --import`) | ✅ | consulta "Bots en el motor" más abajo |
| Unreal, Android, cualquier .exe sin modificar | — | — | [hoja de ruta](#roadmap) |

## Instalación

```bash
git clone https://github.com/mhwangbo/playtest-lab.git
cd playtest-lab && npm test          # no dependencies; Node 20+
```

Para usarlo como skill de Claude Code, haz que la carpeta esté disponible como `~/.claude/skills/playtest-lab` (enlace simbólico o junction). Después, pídele a Claude que haga un "playtest de mi juego".

## Inicio rápido

### 1. Juego web

```bash
node lab/lab.js init --game path/to/game --build http://localhost:5173/
# write path/to/game/.playtest/adapter.mjs  (template copied for you; example: examples/mothlight.adapter.mjs)
node lab/lab.js --game path/to/game run new --label "M1"
node lab/lab.js --game path/to/game bots --runs 30
node lab/lab.js --game path/to/game report
```

El adaptador exporta `create(seed)`, `observe`, `step`, `done`, `metrics`, `idleAction`, `randomAction`, `policies` y, opcionalmente, `findings`. El contrato completo está en [CONTRACT.md](CONTRACT.md).

Personas sobre una build web:

```bash
node lab/lab.js --game path/to/game serve --root dist --port 8120
```

Luego lanza una persona con el prompt de [SKILL.md §3b](SKILL.md). Escribe un `.playtest/perception.js` que describa lo que hay en pantalla; el ejemplo es [examples/mothlight.perception.js](examples/mothlight.perception.js).

### 2. Unity

1. Añade el paquete:
   ```json
   "com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
   ```
2. **Bots:** implementa un `IPlaytestTarget` (reiniciar con una semilla, aplicar una acción, observar, terminado, métricas), genera una build de Windows y apunta el adaptador hacia ella:
   ```js
   export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}'] };
   ```
   El ejemplo completo es [examples/unity-coinline](examples/unity-coinline): 80 partidas sin interfaz en unos 6 s, de forma determinista.
3. **Personas:** añade
   ```js
   export const personaBridge = { command: 'Builds/Win/MyGame.exe', hideWindow: false, args: ['-screen-fullscreen', '0', '-screen-width', '405', '-screen-height', '720', '-playtestPort', '{PORT}', '-playtestUgui'] };
   ```
   Después ejecuta `lab.js host`. Con `-playtestUgui` cualquier juego con uGUI funciona sin código. Para exponer el estado del tablero o del juego, hereda de `PlaytestUguiTarget`.

### 3. Godot 4

1. Copia `engines/godot/addons/playtest_bridge` en tu proyecto y activa el plugin. Registra el autoload `PlaytestBridge`.
2. Coloca un nodo en el grupo `playtest_target` con `reset_game(seed)`, `apply_action(dict)`, `observe()`, `is_done()` y `metrics()`.
3. Apunta el adaptador a Godot:
   ```js
   export const bridge = { command: process.env.GODOT_BIN || 'godot', cwd: '.', args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'] };
   ```
   El ejemplo completo es [examples/godot-coinline](examples/godot-coinline). Da los mismos resultados que el ejemplo de Unity y es determinista.

### Bots en el motor (puzles, juegos por turnos, juegos grandes)

Si tu juego tiene un núcleo de lógica pura, ejecuta los bots dentro del motor (p. ej., Unity `-batchmode -executeMethod`). Escribe los resultados por nivel como `{levels:[{id, …, policies:[{policy, runs, solvedPct, movesP50, …}]}]}` e impórtalos:

```bash
node lab/lab.js --game . bots --import .playtest/my_bots.json
```

Luego, `findingsFromLevels(levels)` en tu adaptador puede comparar los resultados con tu intención de diseño; por ejemplo, las franjas de tiempo de resolución previstas frente al esfuerzo de los bots, niveles atípicos dentro de un tier o reglas que no influyen en nada.

## Cuánto cuesta (medido)

Son precios de lista de la API, obtenidos en sesiones reales con un pequeño juego web y un juego de puzles en Unity:

| Modo | Modelo | Coste / sesión | Notas |
|---|---|---|---|
| Bots | — | $0 | Web: 80 noches en unos 8 s. Unity: 80 partidas en unos 6 s. Núcleo de puzles: 30 niveles × 3 políticas × 30 semillas en unos 4 min |
| Persona web, capturas en cada turno | Sonnet | $1.51 | la línea base de la que partimos |
| Persona web, live-lite (fidelidad humana, visión primero durante 60 s) | Haiku | **$0.39–0.49** | encontró el mismo problema de onboarding verificado que la línea base |
| Persona de motor (build de Unity, comandos `play`) | Haiku | $0.86–1.30 | el coste sube cuando una persona se atasca en un nivel |

## Limitaciones, con honestidad

- **Las personas basadas en LLM son débiles con los puzles espaciales.** Sus dificultades exageran la dificultad que tendría un humano. Úsalas para claridad, onboarding, historia y sensación de juego, y deja la dificultad a los bots y a la telemetría de jugadores reales.
- **La percepción puede ser demasiado amable.** Un volcado exacto del estado hacía que el juego pareciera más claro de lo que se ve en los píxeles (una persona puntuó 5/5 y pasó por alto un problema real de onboarding). De ahí el modo de fidelidad humana y las capturas durante el primer minuto.
- **La percepción también puede ocultar la guía.** Una persona no pudo usar las pistas porque no se describía el resaltado en pantalla de la pista. Refleja cada señal visible.
- **Los modelos baratos a veces afirman acciones que no realizaron.** Solo cuenta lo que el lab registró.
- **Las personas no pueden oír el audio.**

Todo esto surgió de ejecuciones reales y está documentado en [LESSONS.md](LESSONS.md).

<a id="roadmap"></a>
## Hoja de ruta

- **Modo sin integración:** las personas manejan cualquier juego de escritorio sin modificar mediante capturas de pantalla y ratón y teclado reales (computer-use). Más lento, pero sin ninguna integración.
- Puente para **Unreal** (subsistema en C++ o Python) y **Android** (emulador o dispositivo vía adb).
- **Paquete de detección de bugs**, todo gratuito y determinista:
  - hooks de invariantes
  - captura del registro de errores del motor
  - grabación, reproducción y minimización automática de trazas de acciones que fallan
  - bots de caos y de novedad
  - informes de cobertura
  - una puerta de regresión `lab check` contra la última línea base
- **Informe de métricas de diversión:** gradiente de habilidad, proporción de suerte frente a habilidad, estrategias dominantes, curva de tensión, curva de aprendizaje.
- **Personas que revisan repeticiones:** aún más baratas; critican fotogramas clave grabados en lugar de jugar en vivo.
- **Importación de telemetría humana:** calibrar bots y personas con jugadores reales.
- **Clasificación de feedback basada en modelos** como plugin (p. ej., un clasificador local como [laya](https://github.com/NandhaKishorM/laya)).
- **Bots con API de decisión externa** como plugin (p. ej., modelos rápidos de selección de acciones como Jev) usando el `actionMenu` del adaptador.
- Compatibilidad con TextMeshPro en el helper de uGUI; un límite de acciones por nivel para las personas.

## Documentación

- [SKILL.md](SKILL.md): cómo ejecuta un agente el lab, incluidos los prompts de las personas.
- [CONTRACT.md](CONTRACT.md): la API del adaptador y el esquema del informe.
- [SECURITY.md](SECURITY.md): qué se ejecuta en tu máquina y las salvaguardas de las personas.
- [LESSONS.md](LESSONS.md): qué se rompió y cómo se arregló.

## Licencia

[MIT](LICENSE)
