# Cómo contribuir a WinVector

Gracias por tu interés en el proyecto. Esta guía explica cómo está organizado el código, qué necesitas instalar y cómo proponer un cambio.

Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

## Antes de empezar

- Lee el [plan del proyecto](docs/PLAN.md) para entender el alcance de la versión actual y la arquitectura.
- Busca si ya existe un [issue](https://github.com/imontene/winvector/issues) sobre lo que quieres hacer. Si no existe, abre uno antes de dedicar tiempo a un cambio grande, para acordar el enfoque.
- Las decisiones de arquitectura se registran en [`docs/adr/`](docs/adr). Un cambio que afecte a la estructura del proyecto necesita un ADR nuevo.

## Estructura del repositorio

| Carpeta | Contenido | Lenguaje |
|---|---|---|
| `src/WinVector.App` | Aplicación WinUI 3: ventana, menús, paneles | C# |
| `src/WinVector.Core` | Lógica sin interfaz: archivos, ajustes, cliente del puente | C# |
| `src/engine` | Motor de edición que se ejecuta en el lienzo (WebView2) | TypeScript |
| `contracts` | Esquemas de los mensajes entre la aplicación y el motor | JSON Schema |
| `tests` | Pruebas de C# y SVG de referencia (`tests/corpus`) | — |
| `docs` | Plan, decisiones de arquitectura y documentación | Markdown |

## Requisitos

**Para el motor de edición** (funciona en Windows, macOS o Linux):

- [Node.js](https://nodejs.org/) en la versión indicada en `src/engine/.nvmrc`. Con [nvm](https://github.com/nvm-sh/nvm) o [fnm](https://github.com/Schniz/fnm) basta con ejecutar `nvm use` o `fnm use` dentro de `src/engine`.

**Para la aplicación completa** (solo Windows 11):

- Visual Studio 2022 o posterior con las cargas de trabajo **Desarrollo de escritorio de .NET** y **Desarrollo de aplicaciones de Windows** (incluye Windows App SDK).
- El SDK de .NET indicado en `global.json` (se añadirá con el proyecto de la aplicación).
- Node.js, como arriba, porque la compilación de la aplicación incluye el motor.

## Compilar y probar

### Motor de edición

```bash
cd src/engine
npm ci
npm run dev        # servidor de desarrollo con un SVG de ejemplo
npm test           # pruebas unitarias
npm run test:e2e   # pruebas de integración en Chromium
npm run lint
npm run typecheck
npm run build      # genera dist/
```

La primera vez que ejecutes las pruebas de integración instala el navegador con `npx playwright install chromium`.

### Aplicación

Las instrucciones se añadirán con el proyecto WinUI 3 ([#2](https://github.com/imontene/winvector/issues/2)).

## Flujo de trabajo

1. Crea una rama desde `main` con un nombre que indique el tipo de cambio y el issue:
   - `feat/23-herramienta-pluma`
   - `fix/41-zoom-con-rueda`
   - `docs/12-guia-de-atajos`
2. Haz commits pequeños siguiendo [Conventional Commits](https://www.conventionalcommits.org/es/).
3. Abre una pull request contra `main` y rellena la plantilla. Enlaza el issue con `Closes #número`.
4. La CI debe estar en verde y al menos una persona debe aprobar la pull request antes de fusionarla.
5. Las pull requests se fusionan con *squash*, así que el título de la pull request será el mensaje del commit final: escríbelo también con el formato de Conventional Commits.

### Mensajes de commit

```
<tipo>(<ámbito opcional>): <descripción en imperativo y minúsculas>
```

| Tipo | Uso |
|---|---|
| `feat` | Función nueva para el usuario |
| `fix` | Corrección de un error |
| `docs` | Solo documentación |
| `test` | Pruebas nuevas o corregidas |
| `refactor` | Cambio de código que no altera el comportamiento |
| `perf` | Mejora de rendimiento |
| `build` | Sistema de compilación o dependencias |
| `ci` | Configuración de integración continua |
| `chore` | Mantenimiento que no encaja en los anteriores |

Ámbitos habituales: `app`, `core`, `engine`, `contracts`, `ci`, `docs`.

Ejemplos:

```
feat(engine): añade la herramienta de rectángulo
fix(app): conserva la pestaña activa al cerrar otra
```

Un cambio incompatible se marca con `!` después del tipo (`feat(contracts)!: …`) y se explica en el cuerpo del commit.

### Versionado

El proyecto sigue el [versionado semántico](https://semver.org/lang/es/). Mientras la versión sea `0.x`, una versión menor puede incluir cambios incompatibles.

## Estilo de código

- La configuración de formato básica está en `.editorconfig`; la mayoría de los editores la aplican automáticamente.
- **TypeScript:** ESLint y Prettier. Ejecuta `npm run lint` antes de enviar cambios.
- **C#:** las reglas de análisis se configurarán con el proyecto de la aplicación; las advertencias se tratan como errores.
- Comentarios y documentación en español. Los nombres en el código (variables, funciones, tipos) en inglés.

## Pruebas

Todo cambio de comportamiento necesita pruebas:

- Lógica del motor: pruebas unitarias con Vitest junto al código.
- Interacción en el lienzo: pruebas de integración con Playwright en `src/engine/e2e`.
- Archivos SVG que el editor debe abrir y guardar sin dañarlos: añádelos a `tests/corpus` (lee antes su README).

## Informar de errores y proponer funciones

Usa las plantillas al abrir un [issue nuevo](https://github.com/imontene/winvector/issues/new/choose). Para problemas de seguridad sigue la [política de seguridad](SECURITY.md) y no abras un issue público.

## Licencia

Al enviar una contribución aceptas que se distribuya bajo la [licencia Apache 2.0](LICENSE) del proyecto.
