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

- Visual Studio 2026 o posterior con las cargas de trabajo **Desarrollo de escritorio de .NET** y **Desarrollo de aplicaciones de Windows** (incluye Windows App SDK). Hace falta esta versión para .NET 10 y para el formato de solución `.slnx`.
- El SDK de .NET indicado en [`global.json`](global.json) (.NET 10).
- Node.js, como arriba, porque la compilación de la aplicación incluye el motor.

`WinVector.Core` y sus pruebas no dependen de Windows: se compilan y prueban en cualquier sistema con el SDK de .NET.

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

La solución es [`WinVector.slnx`](WinVector.slnx):

| Proyecto | Contenido |
|---|---|
| `src/WinVector.App` | Aplicación WinUI 3 empaquetada como MSIX |
| `src/WinVector.Core` | Modelos de vista y lógica sin interfaz |
| `tests/WinVector.Core.Tests` | Pruebas de `WinVector.Core` con MSTest |

**Con Visual Studio:** abre `WinVector.slnx`, elige la plataforma `x64` o `ARM64` según tu equipo y pulsa F5. El perfil "WinVector (Package)" instala y depura el paquete MSIX.

**Desde la línea de comandos** (en la raíz del repositorio):

```bash
dotnet test tests/WinVector.Core.Tests
dotnet build WinVector.slnx -c Debug -p:Platform=x64
```

Las pruebas de `WinVector.Core` también funcionan en macOS y Linux.

Los textos de la interfaz están en `src/WinVector.App/Strings/<idioma>/Resources.resw` (español `es-ES` e inglés `en-US`). Cada control del XAML los recibe a través de su `x:Uid`. Un texto nuevo debe añadirse en los dos idiomas.

### Probar un paquete de la CI

Cada pull request que toca la aplicación genera paquetes MSIX de prueba para x64 y ARM64. Están en la ejecución del workflow **Aplicación**, en la sección *Artifacts* (`winvector-msix-x64` o `winvector-msix-ARM64`).

Los paquetes no están firmados: el editor del manifiesto lleva el identificador especial que Windows reserva para paquetes sin firmar. Para instalarlos en Windows 11:

1. Descarga el artefacto de tu arquitectura y descomprímelo.
2. Abre PowerShell **como administrador** en esa carpeta.
3. Ejecuta:

   ```powershell
   Add-AppxPackage -Path (Get-ChildItem .\*.msix).FullName -DependencyPath (Get-ChildItem .\Dependencies\*.msix).FullName -AllowUnsigned
   ```

4. Abre WinVector desde el menú Inicio.

Para desinstalarlo: `Get-AppxPackage WinVector | Remove-AppxPackage`.

La CI ejecuta esta misma instalación en Windows en cada cambio. Después arranca la aplicación, hace clic en el círculo del SVG de ejemplo, comprueba con UI Automation que la barra de estado muestra `circle#sol` y guarda una captura de pantalla en el artefacto `captura-prueba-de-humo`. El registro del paso anota también la latencia del puente.

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
- **C#:** la configuración común está en `Directory.Build.props`: nulabilidad activada, analizadores de .NET en el nivel recomendado y advertencias tratadas como errores. Las versiones de los paquetes NuGet se fijan en `Directory.Packages.props`.
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
