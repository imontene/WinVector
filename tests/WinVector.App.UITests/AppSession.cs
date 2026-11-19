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
    public static AppSession Start()
    {
        var aumid = Environment.GetEnvironmentVariable(AumidVariable);
        if (string.IsNullOrEmpty(aumid))
        {
            Assert.Inconclusive($"Instala WinVector y define {AumidVariable} para ejecutar las pruebas de interfaz.");
        }

        var application = Application.LaunchStoreApp(aumid);

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

    /// <summary>Punto de la pantalla que corresponde a unas coordenadas del SVG de ejemplo.</summary>
    /// <remarks>
    /// El motor dibuja el SVG de ejemplo (viewBox 400 × 300) centrado, con un ancho de
    /// min(90 % del ancho, 90 % del alto × 4/3) del lienzo.
    /// </remarks>
    public static Point SamplePoint(Rectangle canvas, double svgX, double svgY)
    {
        var width = Math.Min(canvas.Width * 0.9, canvas.Height * 0.9 * 4 / 3);
        var height = width * 3 / 4;
        return new Point(
            (int)(canvas.X + ((canvas.Width - width) / 2) + (width * svgX / 400)),
            (int)(canvas.Y + ((canvas.Height - height) / 2) + (height * svgY / 300)));
    }
}
