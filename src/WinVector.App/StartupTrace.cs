using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace WinVector.App;

/// <summary>
/// Tiempos de arranque medidos desde dentro de la aplicación (issue #34), en milisegundos desde
/// que empieza el proceso: la ventana carga su contenido, el WebView2 está creado, la página del
/// motor ha cargado y el motor responde. Solo se escriben si existe el archivo
/// <see cref="RequestFile"/> en la carpeta de datos, que crea la prueba de medición del arranque;
/// así la medición no depende de UI Automation, que retrasa la carga del lienzo al activar la
/// accesibilidad de WebView2.
/// </summary>
internal static class StartupTrace
{
    public const string RequestFile = "medir-arranque";
    public const string ResultFile = "arranque.json";

    public const string Window = "windowMs";
    public const string Canvas = "canvasMs";
    public const string WebView = "webViewMs";
    public const string Page = "pageMs";
    public const string Engine = "engineMs";

    private static readonly DateTime ProcessStarted = ProcessStart();
    private static readonly Dictionary<string, double> Milestones = [];
    private static bool _written;

    /// <summary>Anota la primera vez que se alcanza un hito.</summary>
    public static void Mark(string milestone) =>
        Milestones.TryAdd(milestone, (DateTime.UtcNow - ProcessStarted).TotalMilliseconds);

    /// <summary>El motor ha respondido: anota el hito y escribe los tiempos si se pidieron.</summary>
    public static void EngineReady(string folder)
    {
        Mark(Engine);
        if (_written || !File.Exists(Path.Combine(folder, RequestFile)))
        {
            return;
        }

        _written = true;
        var json = new StringBuilder("{");
        foreach (var (name, milliseconds) in Milestones)
        {
            json.Append(CultureInfo.InvariantCulture, $"{(json.Length > 1 ? ", " : " ")}\"{name}\": {Math.Round(milliseconds)}");
        }

        json.Append(" }\n");
        try
        {
            File.WriteAllText(Path.Combine(folder, ResultFile), json.ToString());
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
