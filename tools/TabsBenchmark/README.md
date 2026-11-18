# Medición de pestañas

Herramienta del [ADR 0004](../../docs/adr/0004-pestanas-y-motores.md). Compara la memoria, el tiempo de carga y el tiempo de cambio de pestaña de dos modelos: un WebView2 por pestaña y un motor compartido.

Se ejecuta en Windows desde el workflow **Medición de pestañas** (lanzado a mano o al cambiar esta carpeta). El número de objetos por documento se puede elegir.

Para ejecutarla en local, con el motor compilado (`npm run build` en `src/engine`):

```powershell
dotnet build tools/TabsBenchmark -c Release -o artifacts/bench
artifacts/bench/TabsBenchmark.exe --mode shared --tabs 5 --objects 2000 --output resultado.json
```

`--mode` admite `per-tab` o `shared`. Cada ejecución mide un escenario y escribe un JSON con los resultados.
