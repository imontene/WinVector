using System.Drawing;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;

namespace WinVector.App.UITests;

/// <summary>Abrir y guardar archivos con la aplicación instalada.</summary>
[TestClass]
public sealed class FileTests
{
    private static readonly TimeSpan EngineTimeout = TimeSpan.FromSeconds(20);

    /// <summary>
    /// Espera a que arranque el motor. En un equipo recién creado de la CI, el primer WebView2 de la
    /// sesión puede tardar más de 20 s en arrancar; las demás esperas siguen en 20 s.
    /// </summary>
    private static readonly TimeSpan EngineStartTimeout = TimeSpan.FromSeconds(60);
    private static readonly Color SunOrange = Color.FromArgb(0xff, 0xb5, 0x47);

    private AppSession? _session;
    private string _folder = string.Empty;
    private string _file = string.Empty;

    public TestContext TestContext { get; set; } = null!;

    private AppSession Session => _session ?? throw new InvalidOperationException("La aplicación no está en marcha.");

    [TestInitialize]
    public void PrepareFile()
    {
        // Fuera de AppData: Windows virtualiza las escrituras de las aplicaciones empaquetadas allí.
        _folder = Path.Combine(AppContext.BaseDirectory, "archivos-de-prueba", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_folder);
        _file = Path.Combine(_folder, "prueba de apertura.svg");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Ejemplo.svg"), _file);
    }

    [TestCleanup]
    public void CloseApp()
    {
        if (_session is not null)
        {
            if (TestContext.CurrentTestOutcome != UnitTestOutcome.Passed)
            {
                AppSession.CaptureScreen(TestContext, TestContext.TestName ?? "fallo");
            }

            _session.Dispose();
            _session = null;
        }

        Directory.Delete(_folder, recursive: true);
    }

    [TestMethod]
    public void AbreElArchivoIndicadoAlArrancar()
    {
        _session = AppSession.Start($"\"{_file}\"");
        WaitForEngine();

        Assert.IsTrue(
            Retry.WhileFalse(() => Tabs().Select(t => t.Name).SequenceEqual(["prueba de apertura.svg"]), EngineTimeout).Result,
            $"Pestañas: {string.Join(", ", Tabs().Select(t => t.Name))}");
        Assert.IsTrue(SunIsVisible(), "El documento abierto no se ve en el lienzo.");
    }

    [TestMethod]
    public void GuardarSinCambiosDejaElArchivoIdentico()
    {
        var original = File.ReadAllBytes(_file);
        var before = File.GetLastWriteTimeUtc(_file);
        _session = AppSession.Start($"\"{_file}\"");
        WaitForEngine();
        Assert.IsTrue(SunIsVisible(), "El documento abierto no se ve en el lienzo.");

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_S);

        Assert.IsTrue(
            Retry.WhileFalse(() => File.GetLastWriteTimeUtc(_file) > before, TimeSpan.FromSeconds(10)).Result,
            "Ctrl+S no escribió el archivo.");
        CollectionAssert.AreEqual(original, File.ReadAllBytes(_file));
        Assert.AreEqual("prueba de apertura.svg", string.Join(", ", Directory.GetFiles(_folder).Select(Path.GetFileName)));
    }

    private AutomationElement[] Tabs() =>
        Session.GetById("DocumentTabs").FindAllDescendants(cf => cf.ByControlType(ControlType.TabItem));

    private void WaitForEngine() =>
        Assert.IsTrue(
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineStartTimeout).Result,
            "El motor no terminó de cargar.");

    private bool SunIsVisible()
    {
        var sun = AppSession.SamplePoint(Session.GetById("EngineCanvas").BoundingRectangle, 300, 96);
        return Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), SunOrange), EngineTimeout, TimeSpan.FromMilliseconds(250)).Result;
    }
}
