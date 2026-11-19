using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

[TestClass]
public sealed class MainWindowTests
{
    private static readonly TimeSpan EngineTimeout = TimeSpan.FromSeconds(20);

    private AppSession? _session;

    public TestContext TestContext { get; set; } = null!;

    private AppSession Session => _session ?? throw new InvalidOperationException("La aplicación no está en marcha.");

    [TestInitialize]
    public void StartApp() => _session = AppSession.Start();

    [TestCleanup]
    public void CloseApp()
    {
        if (_session is null)
        {
            return;
        }

        if (TestContext.CurrentTestOutcome != UnitTestOutcome.Passed)
        {
            AppSession.CaptureScreen(TestContext, TestContext.TestName ?? "fallo");
        }

        _session.Dispose();
        _session = null;
    }

    [TestMethod]
    public void LaVentanaSeLlamaWinVector()
    {
        Assert.AreEqual("WinVector", Session.Window.Title);
    }

    [TestMethod]
    public void EmpiezaConUnaPestaña()
    {
        Assert.HasCount(1, Tabs());
    }

    [TestMethod]
    public void CtrlNAbreOtraPestañaYCtrlWLaCierra()
    {
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_N);
        Assert.IsTrue(Retry.WhileFalse(() => Tabs().Length == 2, TimeSpan.FromSeconds(5)).Result, "Ctrl+N no abrió otra pestaña.");

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_W);
        Assert.IsTrue(Retry.WhileFalse(() => Tabs().Length == 1, TimeSpan.FromSeconds(5)).Result, "Ctrl+W no cerró la pestaña.");
    }

    [TestMethod]
    public void ElMotorCargaYMideLaLatenciaDelPuente()
    {
        var latency = Retry.WhileNull(
            () => NullIfEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault),
            EngineTimeout,
            TimeSpan.FromMilliseconds(250)).Result;

        Assert.IsNotNull(latency, "La barra de estado no muestra la latencia del puente: el motor no se anunció.");
        TestContext.WriteLine($"Latencia del puente: {latency}");
    }

    [TestMethod]
    public void ClicEnElSolLoSelecciona()
    {
        ClickSample(300, 96);

        Assert.AreEqual("circle#sol", Session.WaitForName("SelectionStatus", name => name == "circle#sol", EngineTimeout));
    }

    [TestMethod]
    public void ClicEnElTituloSeleccionaElTextoEntero()
    {
        ClickSample(100, 87);

        Assert.AreEqual("text#titulo", Session.WaitForName("SelectionStatus", name => name == "text#titulo", EngineTimeout));
    }

    [TestMethod]
    public void ClicFueraDelDocumentoVaciaLaSeleccion()
    {
        ClickSample(300, 96);
        Session.WaitForName("SelectionStatus", name => name == "circle#sol", EngineTimeout);

        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.Click(new System.Drawing.Point(canvas.X + 4, canvas.Y + 4));

        Assert.AreEqual(string.Empty, Session.WaitForName("SelectionStatus", string.IsNullOrEmpty, EngineTimeout));
    }

    [TestMethod]
    public void AbrirElEjemploAñadeUnaPestañaConSuDocumento()
    {
        WaitForEngine();
        Session.OpenSample();

        Assert.HasCount(2, Tabs());
        Assert.IsNotNull(Session.FindSampleText());
    }

    [TestMethod]
    public void CadaPestañaMuestraSuDocumento()
    {
        WaitForEngine();
        Session.OpenSample();

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_N);
        Assert.IsTrue(
            Retry.WhileFalse(() => Session.FindSampleText() is null, TimeSpan.FromSeconds(10)).Result,
            "El documento de ejemplo sigue visible en una pestaña nueva.");

        Tabs()[1].Click();
        Assert.IsTrue(
            Retry.WhileFalse(() => Session.FindSampleText() is not null, TimeSpan.FromSeconds(10)).Result,
            "Al volver a la pestaña del ejemplo no se muestra su documento.");
    }

    /// <summary>
    /// Abrir un documento mientras el motor aún carga: debe mostrarse en cuanto el motor esté listo.
    /// </summary>
    [TestMethod]
    public void UnDocumentoAbiertoAntesDeQueCargueElMotorSeMuestraAlCargar()
    {
        Session.GetById("HelpMenu").Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp("OpenSampleMenuItem"), TimeSpan.FromSeconds(10)).Result;
        Assert.IsNotNull(item, "No aparece el menú del documento de ejemplo.");
        item.Patterns.Invoke.Pattern.Invoke();

        WaitForEngine();
        var shown = Retry.WhileNull(() => Session.FindSampleText(), TimeSpan.FromSeconds(20), TimeSpan.FromMilliseconds(250)).Result;
        if (shown is null)
        {
            using var fresh = new FlaUI.UIA3.UIA3Automation();
            var freshWindow = Session.Application.GetMainWindow(fresh);
            var freshCanvas = freshWindow?.FindFirstDescendant(cf => cf.ByAutomationId("EngineCanvas"));
            var freshText = freshCanvas?.FindFirstDescendant(cf => cf.ByName("WinVector"));
            TestContext.WriteLine($"Pestañas: {Tabs().Length}");
            TestContext.WriteLine($"Latencia (motor listo): '{Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault}'");
            TestContext.WriteLine($"Con una conexión nueva de UI Automation, el texto {(freshText is null ? "tampoco aparece" : "sí aparece")}");
            var tabs = Tabs();
            TestContext.WriteLine("Pestañas seleccionadas: " + string.Join(", ", tabs.Select(t =>
                $"{t.Name}={t.Patterns.SelectionItem.PatternOrDefault?.IsSelected.ValueOrDefault}")));
            tabs[^1].Click();
            var afterClick = Retry.WhileNull(() => Session.FindSampleText(), TimeSpan.FromSeconds(5)).Result;
            TestContext.WriteLine($"Tras pulsar la pestaña del ejemplo, el texto {(afterClick is null ? "sigue sin aparecer" : "aparece")}");

            // TEMPORAL: captura reducida en el registro para ver si el documento se pinta.
            using var screen = FlaUI.Core.Capturing.Capture.Screen().Bitmap;
            using var small = new System.Drawing.Bitmap(screen, screen.Width * 3 / 4, screen.Height * 3 / 4);
            using var stream = new MemoryStream();
            small.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
            var base64 = Convert.ToBase64String(stream.ToArray());
            for (var i = 0; i < base64.Length; i += 4000)
            {
                TestContext.WriteLine($"CAPTURA:{base64.AsSpan(i, Math.Min(4000, base64.Length - i))}");
            }
        }

        Assert.IsNotNull(shown, "El documento abierto antes de cargar el motor no se muestra.");
    }

    /// <summary>
    /// Investigación (#9): ¿se ve el contenido web del lienzo desde UI Automation? Si se ve, las
    /// pruebas de interfaz podrán comprobar también lo que dibuja el motor.
    /// </summary>
    [TestMethod]
    public void ElContenidoDelLienzoEsAccesible()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas");

        var text = Retry.WhileNull(
            () => canvas.FindFirstDescendant(cf => cf.ByName("WinVector")),
            TimeSpan.FromSeconds(10),
            TimeSpan.FromMilliseconds(250)).Result;

        Assert.IsNotNull(text, "El texto 'WinVector' del SVG de ejemplo no aparece en el árbol de UI Automation del lienzo.");
        TestContext.WriteLine($"Texto del SVG accesible como {text.ControlType}");
    }

    private AutomationElement[] Tabs() =>
        Session.GetById("DocumentTabs").FindAllDescendants(cf => cf.ByControlType(ControlType.TabItem));

    private void WaitForEngine() =>
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineTimeout).Result,
            "El motor no terminó de cargar.");

    private void ClickSample(double svgX, double svgY)
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.Click(AppSession.SamplePoint(canvas, svgX, svgY));
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
