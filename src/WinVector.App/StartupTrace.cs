using System.Diagnostics;
using System.Globalization;

namespace WinVector.App;

/// <summary>
/// Tiempos de arranque medidos desde dentro de la aplicación (issue #34): desde que empieza el
/// proceso hasta que la ventana carga su contenido y hasta que el motor del lienzo está listo.
/// Solo se escriben si existe el archivo <see cref="RequestFile"/> en la carpeta de datos, que crea
/// la prueba de medición del arranque; así la medición no depende de UI Automation, que retrasa
/// la carga del lienzo al activar la accesibilidad de WebView2.
/// </summary>
internal sealed class StartupTrace(string folder)
{
    public const string RequestFile = "medir-arranque";
    public const string ResultFile = "arranque.json";

    private readonly DateTime _processStart = ProcessStart();
    private double? _windowMs;
    private bool _done;

    private double Elapsed => (DateTime.UtcNow - _processStart).TotalMilliseconds;

    /// <summary>La ventana ha cargado su contenido.</summary>
    public void WindowLoaded() => _windowMs ??= Elapsed;

    /// <summary>El motor ha respondido: escribe los tiempos si se pidieron.</summary>
    public void EngineReady()
    {
        if (_done)
        {
            return;
        }

        _done = true;
        var engineMs = Elapsed;
        if (!File.Exists(Path.Combine(folder, RequestFile)))
        {
            return;
        }

        var json = string.Create(
            CultureInfo.InvariantCulture,
            $"{{ \"windowMs\": {Math.Round(_windowMs ?? engineMs)}, \"engineMs\": {Math.Round(engineMs)} }}\n");
        try
        {
            File.WriteAllText(Path.Combine(folder, ResultFile), json);
        }
        catch (IOException ex)
        {
            Debug.WriteLine($"No se pudieron escribir los tiempos de arranque: {ex.Message}");
        }
    }

    private static DateTime ProcessStart()
    {
        using var process = Process.GetCurrentProcess();
        return process.StartTime.ToUniversalTime();
    }
}
