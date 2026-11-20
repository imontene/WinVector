using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace WinVector.App;

/// <summary>
/// Tiempos de arranque medidos desde dentro de la aplicación (issue #34), en milisegundos desde
/// que empieza el proceso: la ventana carga su contenido, el lienzo empieza a crear el WebView2,
/// el WebView2 está creado, el puente está listo, el motor responde y su página termina de cargar. Solo se escriben si existe el archivo
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
    public const string Engine = "engineMs";

    public const string Bridge = "bridgeMs";
    public const string Page = "pageMs";

    private static readonly DateTime ProcessStarted = ProcessStart();
    private static readonly Dictionary<string, double> Milestones = [];
    private static string? _folder;

    /// <summary>Empieza a anotar si la prueba lo ha pedido con el archivo de petición en <paramref name="folder"/>.</summary>
    public static void Start(string folder)
    {
        _folder = File.Exists(Path.Combine(folder, RequestFile)) ? folder : null;
    }

    /// <summary>
    /// Anota la primera vez que se alcanza un hito y, si se pidió, reescribe el archivo con todos los
    /// anotados hasta ahora: si el motor no llega a estar listo, la prueba sabe hasta dónde llegó.
    /// </summary>
    public static void Mark(string milestone)
    {
        if (!Milestones.TryAdd(milestone, (DateTime.UtcNow - ProcessStarted).TotalMilliseconds) || _folder is null)
        {
            return;
        }

        var json = new StringBuilder("{");
        foreach (var (name, milliseconds) in Milestones)
        {
            json.Append(CultureInfo.InvariantCulture, $"{(json.Length > 1 ? ", " : " ")}\"{name}\": {Math.Round(milliseconds)}");
        }

        json.Append(" }\n");
        try
        {
            File.WriteAllText(Path.Combine(_folder, ResultFile), json.ToString());
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
