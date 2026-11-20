using System.Globalization;
using System.Diagnostics;
using System.Drawing;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Tools;
using FlaUI.UIA3;

namespace WinVector.App.UITests;

/// <summary>
/// Una ejecución de WinVector controlada con UI Automation. Arranca la aplicación instalada y la
/// cierra al descartarse.
/// </summary>
internal sealed class AppSession : IDisposable
{
    public const string AumidVariable = "WINVECTOR_AUMID";

    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan UiaTimeout = TimeSpan.FromSeconds(15);

    private AppSession(Application application, UIA3Automation automation, Window window)
    {
        Application = application;
        Automation = automation;
        Window = window;
    }

    public Application Application { get; }

    /// <summary>
    /// Obtiene la ventana principal y reintenta si UI Automation agota el tiempo al conectarse,
    /// hasta <see cref="StartTimeout"/>.
    /// </summary>
    private static Window GetMainWindowWithRetry(Application application, UIA3Automation automation)
    {
        var deadline = DateTime.UtcNow + StartTimeout;
        while (true)
        {
            try
            {
                var remaining = deadline - DateTime.UtcNow;
                return application.GetMainWindow(automation, remaining > TimeSpan.Zero ? remaining : TimeSpan.FromSeconds(1))
                    ?? throw new InvalidOperationException("WinVector no abrió su ventana principal.");
            }
            catch (TimeoutException) when (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(TimeSpan.FromSeconds(1));
            }
        }
    }

    public UIA3Automation Automation { get; }

    public Window Window { get; }

    /// <summary>Arranca WinVector o marca la prueba como no concluyente si no está instalado.</summary>
    /// <param name="arguments">Argumentos de arranque, por ejemplo la ruta de un archivo para abrir.</param>
    public static AppSession Start(string? arguments = null, bool keepRecovery = false)
    {
        var aumid = Environment.GetEnvironmentVariable(AumidVariable);
        if (string.IsNullOrEmpty(aumid))
        {
            Assert.Inconclusive($"Instala WinVector y define {AumidVariable} para ejecutar las pruebas de interfaz.");
        }

        // Una prueba que termina con cambios sin guardar cierra la aplicación a la fuerza y deja copias
        // de recuperación: la siguiente no debe encontrarse con "¿Recuperar documentos?".
        if (!keepRecovery)
        {
            DeleteRecoveryCopies(aumid);
        }

        var application = Application.LaunchStoreApp(aumid, arguments ?? string.Empty);

        // En un arranque en frío (el primero tras instalar el paquete) la ventana tarda en responder a
        // UI Automation más que los tiempos predeterminados, y la primera conexión agota el tiempo.
        var automation = new UIA3Automation
        {
            ConnectionTimeout = UiaTimeout,
            TransactionTimeout = UiaTimeout,
        };
        try
        {
            var window = GetMainWindowWithRetry(application, automation);
            window.SetForeground();
            return new AppSession(application, automation, window);
        }
        catch
        {
            automation.Dispose();
            application.Kill();
            application.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Busca un elemento por su AutomationId (en WinUI, el x:Name si no se indica otro). Recorre la
    /// vista completa del árbol, porque algunos elementos de WinUI, como los TextBlock, no siempre
    /// están en la vista de controles.
    /// </summary>
    public AutomationElement? FindById(string automationId)
    {
        var found = Window.FindFirstDescendant(cf => cf.ByAutomationId(automationId));
        if (found is not null)
        {
            return found;
        }

        var walker = Automation.TreeWalkerFactory.GetRawViewWalker();
        var pending = new Queue<AutomationElement>([Window]);
        while (pending.Count > 0)
        {
            var node = pending.Dequeue();
            if (node.Properties.AutomationId.ValueOrDefault == automationId)
            {
                return node;
            }

            for (var child = walker.GetFirstChild(node); child is not null; child = walker.GetNextSibling(child))
            {
                pending.Enqueue(child);
            }
        }

        return null;
    }

    /// <summary>
    /// Busca un elemento por AutomationId en todas las ventanas de la aplicación, incluidas las de
    /// los menús desplegables, que pueden ser ventanas propias.
    /// </summary>
    public AutomationElement? FindInApp(string automationId)
    {
        var inWindow = FindById(automationId);
        if (inWindow is not null)
        {
            return inWindow;
        }

        var processId = Application.ProcessId;
        foreach (var window in Automation.GetDesktop().FindAllChildren(cf => cf.ByProcessId(processId)))
        {
            var found = window.FindFirstDescendant(cf => cf.ByAutomationId(automationId));
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }

    /// <summary>Abre el documento de ejemplo desde el menú Ayuda y espera a que se muestre.</summary>
    public void OpenSample()
    {
        GetById("HelpMenu").Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => FindInApp("OpenSampleMenuItem"), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException("No aparece Ayuda > Abrir el documento de ejemplo.");
        item.Patterns.Invoke.Pattern.Invoke();

        if (Retry.WhileNull(() => FindSampleText(), TimeSpan.FromSeconds(20), TimeSpan.FromMilliseconds(250)).Result is null)
        {
            throw new AssertFailedException("El documento de ejemplo no aparece en el lienzo.");
        }
    }

    /// <summary>El texto "WinVector" del documento de ejemplo dentro del lienzo, si está visible.</summary>
    public AutomationElement? FindSampleText() =>
        FindById("EngineCanvas")?.FindFirstDescendant(cf => cf.ByName("WinVector").And(cf.ByControlType(FlaUI.Core.Definitions.ControlType.Text)));

    public AutomationElement GetById(string automationId) =>
        FindById(automationId) ?? throw new AssertFailedException($"No se encuentra el elemento con AutomationId '{automationId}'.");

    /// <summary>Espera hasta que el nombre accesible de un elemento cumpla una condición.</summary>
    public string WaitForName(string automationId, Func<string, bool> condition, TimeSpan timeout)
    {
        var result = Retry.WhileFalse(
            () => condition(FindById(automationId)?.Properties.Name.ValueOrDefault ?? string.Empty),
            timeout,
            TimeSpan.FromMilliseconds(250));
        return FindById(automationId)?.Properties.Name.ValueOrDefault ?? (result.Success ? string.Empty : "<sin elemento>");
    }

    /// <summary>Guarda una captura de la pantalla y la adjunta al resultado de la prueba.</summary>
    public static void CaptureScreen(TestContext context, string name)
    {
        var folder = context.TestResultsDirectory ?? Path.GetTempPath();
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, $"{name}.png");
        FlaUI.Core.Capturing.Capture.Screen().ToFile(path);
        context.AddResultFile(path);
    }

    /// <summary>
    /// Carpeta de las copias de recuperación de la aplicación instalada: la carpeta local del paquete
    /// (%LOCALAPPDATA%\Packages\&lt;familia&gt;\LocalState\Recuperacion).
    /// </summary>
    public static string RecoveryFolder(string aumid) =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Packages",
            aumid.Split('!')[0],
            "LocalState",
            "Recuperacion");

    private static void DeleteRecoveryCopies(string aumid)
    {
        var folder = RecoveryFolder(aumid);
        if (Directory.Exists(folder))
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    /// <summary>Mata la aplicación, como un cierre inesperado: no pregunta nada ni guarda nada.</summary>
    public void Kill()
    {
        var processId = Application.ProcessId;
        Application.Kill();
        WaitForExit(processId);
    }

    /// <summary>
    /// Mata los procesos de renderizado de WebView2 de esta aplicación, como si el lienzo fallara.
    /// Devuelve cuántos ha matado.
    /// </summary>
    public int KillCanvasRenderers()
    {
        var killed = 0;
        using var searcher = new System.Management.ManagementObjectSearcher(
            "SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedgewebview2.exe'");
        var processes = searcher.Get().Cast<System.Management.ManagementObject>()
            .Select(process => (
                Id: Convert.ToInt32(process["ProcessId"], CultureInfo.InvariantCulture),
                Parent: Convert.ToInt32(process["ParentProcessId"], CultureInfo.InvariantCulture),
                CommandLine: process["CommandLine"] as string ?? string.Empty))
            .ToList();
        // Los procesos de WebView2 de la aplicación descienden del navegador que lanzó su proceso.
        var ours = new HashSet<int> { Application.ProcessId };
        bool added;
        do
        {
            added = false;
            foreach (var process in processes.Where(process => ours.Contains(process.Parent) && ours.Add(process.Id)))
            {
                added = true;
            }
        }
        while (added);

        foreach (var renderer in processes.Where(process => ours.Contains(process.Id) && process.CommandLine.Contains("--type=renderer", StringComparison.Ordinal)))
        {
            try
            {
                Process.GetProcessById(renderer.Id).Kill();
                killed++;
            }
            catch (ArgumentException)
            {
                // Ya había terminado.
            }
        }

        return killed;
    }

    public void Dispose()
    {
        var processId = Application.ProcessId;
        Automation.Dispose();
        if (!Application.HasExited)
        {
            Application.Close();
            if (!Application.HasExited)
            {
                Application.Kill();
            }
        }

        Application.Dispose();
        WaitForExit(processId);
    }

    private static void WaitForExit(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            process.WaitForExit(TimeSpan.FromSeconds(10));
        }
        catch (ArgumentException)
        {
            // Ya terminó.
        }
    }

    /// <summary>Color del píxel de la pantalla en un punto.</summary>
    public static Color ColorAt(Point point)
    {
        using var image = FlaUI.Core.Capturing.Capture.Rectangle(new Rectangle(point.X, point.Y, 1, 1));
        return image.Bitmap.GetPixel(0, 0);
    }

    /// <summary>True si dos colores se parecen, canal a canal, dentro de una tolerancia.</summary>
    public static bool IsClose(Color actual, Color expected, int tolerance = 24) =>
        Math.Abs(actual.R - expected.R) <= tolerance
        && Math.Abs(actual.G - expected.G) <= tolerance
        && Math.Abs(actual.B - expected.B) <= tolerance;

    /// <summary>Punto de la pantalla que corresponde a un punto del SVG de ejemplo (viewBox 400 × 300).</summary>
    /// <remarks>
    /// Al abrirlo, el motor ajusta la mesa de trabajo (800 × 600) al lienzo sin las reglas (20 px a la
    /// izquierda y arriba), con un margen de 24 px, y la centra. Supone una escala de pantalla del 100 %.
    /// </remarks>
    public static Point SamplePoint(Rectangle canvas, double svgX, double svgY)
    {
        const double Ruler = 20;
        const double Margin = 24;
        var areaX = canvas.X + Ruler;
        var areaY = canvas.Y + Ruler;
        var areaWidth = canvas.Width - Ruler;
        var areaHeight = canvas.Height - Ruler;
        var zoom = Math.Min((areaWidth - (2 * Margin)) / 800, (areaHeight - (2 * Margin)) / 600);
        var width = 800 * zoom;
        var height = 600 * zoom;
        return new Point(
            (int)(areaX + ((areaWidth - width) / 2) + (width * svgX / 400)),
            (int)(areaY + ((areaHeight - height) / 2) + (height * svgY / 300)));
    }
}
