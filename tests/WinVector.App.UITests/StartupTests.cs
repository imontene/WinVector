using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using FlaUI.Core;

namespace WinVector.App.UITests;

/// <summary>
/// Mide el arranque de la aplicación (issue #34; objetivo: ventana lista en menos de 2 s en frío).
/// En la CI se ejecuta aparte, justo después de instalar el paquete, para que el primer arranque sea
/// en frío; si <see cref="OutputVariable"/> indica un archivo, escribe ahí los resultados en JSON.
/// </summary>
/// <remarks>
/// No usa UI Automation: consultar el árbol de accesibilidad activa la de WebView2 y retrasa la
/// carga del lienzo. La ventana se detecta por su identificador de ventana y el motor lo anota la
/// propia aplicación (StartupTrace) cuando existe el archivo de petición en su carpeta de datos.
/// </remarks>
[TestClass]
[TestCategory(Category)]
public sealed class StartupTests
{
    public const string Category = "Rendimiento";
    public const string OutputVariable = "WINVECTOR_PERF_OUTPUT";

    private const string RequestFile = "medir-arranque";
    private const string ResultFile = "arranque.json";
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public void MideElArranqueEnFrioYEnCaliente()
    {
        var aumid = Environment.GetEnvironmentVariable(AppSession.AumidVariable);
        if (string.IsNullOrEmpty(aumid))
        {
            Assert.Inconclusive($"Instala WinVector y define {AppSession.AumidVariable} para medir el arranque.");
        }

        var data = Path.GetDirectoryName(AppSession.RecoveryFolder(aumid))!;
        Directory.CreateDirectory(data);
        var request = Path.Combine(data, RequestFile);
        File.WriteAllText(request, string.Empty);
        try
        {
            var cold = Measure(aumid, data);
            var warm = Measure(aumid, data);
            TestContext.WriteLine($"En frío: {cold}");
            TestContext.WriteLine($"En caliente: {warm}");

            var output = Environment.GetEnvironmentVariable(OutputVariable);
            if (!string.IsNullOrEmpty(output))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
                File.WriteAllText(output, JsonSerializer.Serialize(new { measuredAt = DateTimeOffset.UtcNow, cold, warm }, JsonOptions) + "\n");
            }
        }
        finally
        {
            File.Delete(request);
        }
    }

    /// <summary>Arranca la aplicación, mide cuándo está lista y la cierra.</summary>
    private static Startup Measure(string aumid, string data)
    {
        var result = Path.Combine(data, ResultFile);
        File.Delete(result);
        if (Directory.Exists(AppSession.RecoveryFolder(aumid)))
        {
            Directory.Delete(AppSession.RecoveryFolder(aumid), recursive: true);
        }

        var launched = DateTime.UtcNow;
        var watch = Stopwatch.StartNew();
        using var application = Application.LaunchStoreApp(aumid);
        using var process = Process.GetProcessById(application.ProcessId);
        var processStarted = process.StartTime.ToUniversalTime();

        // La ventana: cuando el proceso tiene una ventana principal visible.
        double? windowMs = null;
        while (watch.Elapsed < Timeout && windowMs is null)
        {
            process.Refresh();
            Assert.IsFalse(process.HasExited, "La aplicación se cerró al arrancar.");
            if (process.MainWindowHandle != IntPtr.Zero)
            {
                windowMs = watch.Elapsed.TotalMilliseconds;
            }
            else
            {
                Thread.Sleep(5);
            }
        }

        Assert.IsNotNull(windowMs, "La ventana no apareció.");

        // El motor: lo anota la aplicación, en milisegundos desde que empezó el proceso.
        while (watch.Elapsed < Timeout && !File.Exists(result))
        {
            Thread.Sleep(20);
        }

        Assert.IsTrue(File.Exists(result), "La aplicación no anotó cuándo estuvo listo el motor.");
        using var times = JsonDocument.Parse(ReadShared(result));
        var startOffset = Math.Max(0, (processStarted - launched).TotalMilliseconds);
        var startup = new Startup(
            (int)Math.Round(windowMs.Value),
            (int)Math.Round(startOffset + times.RootElement.GetProperty("windowMs").GetDouble()),
            (int)Math.Round(startOffset + times.RootElement.GetProperty("engineMs").GetDouble()));

        application.Close();
        if (!process.WaitForExit(TimeSpan.FromSeconds(10)))
        {
            application.Kill();
        }

        return startup;
    }

    /// <summary>Lee el archivo aunque la aplicación aún lo tenga abierto.</summary>
    private static string ReadShared(string path)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var reader = new StreamReader(stream);
                var text = reader.ReadToEnd();
                if (text.Length > 0)
                {
                    return text;
                }
            }
            catch (IOException)
            {
                // La aplicación aún lo está escribiendo.
            }

            Thread.Sleep(20);
        }

        throw new AssertFailedException($"No se pudo leer {path}.");
    }

    /// <summary>Tiempos desde que se pide arrancar la aplicación, en milisegundos.</summary>
    /// <param name="WindowMs">Hasta que se ve la ventana principal.</param>
    /// <param name="ContentMs">Hasta que la ventana ha cargado su contenido.</param>
    /// <param name="EngineMs">Hasta que el motor del lienzo responde.</param>
    private sealed record Startup(int WindowMs, int ContentMs, int EngineMs)
    {
        public override string ToString() => string.Create(
            CultureInfo.InvariantCulture,
            $"ventana {WindowMs} ms, contenido {ContentMs} ms, motor {EngineMs} ms");
    }
}
