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
    public void SinCambiosDeshacerYRehacerEstanDesactivados()
    {
        var undo = Session.GetById("UndoButton");
        var redo = Session.GetById("RedoButton");

        Assert.IsFalse(undo.IsEnabled, "Deshacer está activo en un documento sin cambios.");
        Assert.IsFalse(redo.IsEnabled, "Rehacer está activo en un documento sin cambios.");
        Assert.IsFalse(string.IsNullOrEmpty(undo.Name), "El botón Deshacer no tiene nombre accesible.");
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
    public void ClicEnElSolSeleccionaSuGrupo()
    {
        // Un clic selecciona el objeto de nivel superior: el sol está dentro de g#fondo.
        ClickSample(300, 96);

        Assert.AreEqual("g#fondo", Session.WaitForName("SelectionStatus", name => name == "g#fondo", EngineTimeout));
    }

    [TestMethod]
    public void CtrlClicEnElTituloSeleccionaElTextoEntero()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        // Primero un clic en el lienzo, para que la página reciba el teclado y vea pulsar Ctrl.
        Mouse.Click(new System.Drawing.Point(canvas.X + 4, canvas.Y + 4));
        // El teclado llega a la página por WebView2 y el ratón por WinUI. Con la entrada sintética de
        // la prueba, el clic a veces se adelanta a la tecla aunque se espere; una persona pulsa Ctrl
        // bastante antes de hacer clic. Por eso se intenta hasta tres veces.
        var status = string.Empty;
        for (var attempt = 0; attempt < 3 && status != "text#titulo"; attempt++)
        {
            using (Keyboard.Pressing(VirtualKeyShort.CONTROL))
            {
                Thread.Sleep(500);
                Mouse.Click(AppSession.SamplePoint(canvas, 100, 87));
                Thread.Sleep(200);
            }

            status = Session.WaitForName("SelectionStatus", name => name == "text#titulo", TimeSpan.FromSeconds(5));
        }

        Assert.AreEqual("text#titulo", status);
    }

    [TestMethod]
    public void DobleClicEntraEnElGrupoYEscSale()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 300, 96));

        // "circle#sol en g#fondo": el texto que une los dos depende del idioma.
        static bool InsideGroup(string name) =>
            name.StartsWith("circle#sol", StringComparison.Ordinal) && name.EndsWith("g#fondo", StringComparison.Ordinal);
        var inside = Session.WaitForName("SelectionStatus", InsideGroup, EngineTimeout);
        Assert.IsTrue(InsideGroup(inside), $"El doble clic no entró en el grupo: {inside}");

        // Esc deselecciona y sigue dentro del grupo ("En g#fondo")...
        Keyboard.Press(VirtualKeyShort.ESCAPE);
        static bool OnlyGroup(string name) =>
            !name.StartsWith("circle#sol", StringComparison.Ordinal) && name.EndsWith(" g#fondo", StringComparison.Ordinal);
        var deselected = Session.WaitForName("SelectionStatus", OnlyGroup, EngineTimeout);
        Assert.IsTrue(OnlyGroup(deselected), $"El primer Esc no deseleccionó: {deselected}");

        // ...y otro Esc sale del grupo y lo selecciona.
        Keyboard.Press(VirtualKeyShort.ESCAPE);
        Assert.AreEqual("g#fondo", Session.WaitForName("SelectionStatus", name => name == "g#fondo", EngineTimeout));
    }

    [TestMethod]
    public void CtrlAEnElLienzoSeleccionaTodo()
    {
        ClickSample(300, 96);
        Session.WaitForName("SelectionStatus", name => name == "g#fondo", EngineTimeout);

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);

        // "2 objetos": g#fondo y g#contenido.
        var all = Session.WaitForName("SelectionStatus", name => name.StartsWith('2'), EngineTimeout);
        Assert.StartsWith("2", all, "Ctrl+A no seleccionó los dos grupos del ejemplo.");
    }

    [TestMethod]
    public void ElMenuVerCambiaElZoomDeLaBarraDeEstado()
    {
        WaitForEngine();
        Session.OpenSample();
        var fitted = Session.WaitForName("ZoomStatus", name => name.Length > 0, EngineTimeout);
        Assert.IsGreaterThan(0, fitted.Length, "La barra de estado no muestra el zoom.");

        InvokeViewMenu("MenuViewActualSize");
        var actual = Session.WaitForName("ZoomStatus", name => name.StartsWith("100", StringComparison.Ordinal), EngineTimeout);
        StringAssert.StartsWith(actual, "100");

        InvokeViewMenu("MenuViewZoomIn");
        var zoomedIn = Session.WaitForName("ZoomStatus", name => name.StartsWith("150", StringComparison.Ordinal), EngineTimeout);
        StringAssert.StartsWith(zoomedIn, "150");

        InvokeViewMenu("MenuViewFit");
        Assert.AreEqual(fitted, Session.WaitForName("ZoomStatus", name => name == fitted, EngineTimeout));
    }

    [TestMethod]
    public void CtrlUnoYCtrlCeroConElLienzoEnfocado()
    {
        WaitForEngine();
        Session.OpenSample();
        var fitted = Session.WaitForName("ZoomStatus", name => name.Length > 0, EngineTimeout);
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.Click(new System.Drawing.Point(canvas.X + 4, canvas.Y + 4));
        Thread.Sleep(300);

        // Con el lienzo enfocado, los atajos de zoom los atiende el motor.
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_1);
        var actual = Session.WaitForName("ZoomStatus", name => name.StartsWith("100", StringComparison.Ordinal), EngineTimeout);
        StringAssert.StartsWith(actual, "100", "Ctrl+1 con el lienzo enfocado no cambió el zoom.");

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_0);
        Assert.AreEqual(fitted, Session.WaitForName("ZoomStatus", name => name == fitted, EngineTimeout));
    }

    [TestMethod]
    public void CtrlNConElLienzoEnfocadoAbreOtraPestaña()
    {
        // Con el lienzo enfocado, el teclado va a la página: el motor reenvía Ctrl+N a la aplicación.
        WaitForEngine();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.Click(new System.Drawing.Point(canvas.X + 4, canvas.Y + 4));
        Thread.Sleep(300);

        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_N);

        Assert.IsTrue(Retry.WhileFalse(() => Tabs().Length == 2, TimeSpan.FromSeconds(5)).Result, "Ctrl+N con el lienzo enfocado no abrió otra pestaña.");
    }

    [TestMethod]
    public void LaHerramientaManoDesplazaSinSeleccionar()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        Session.GetById("ToolHand").Click();

        Mouse.Drag(sun, new System.Drawing.Point(sun.X - 120, sun.Y));

        // El sol se ha movido con el lienzo: ahora está 120 px a la izquierda, y nada se ha seleccionado.
        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(new System.Drawing.Point(sun.X - 120, sun.Y)), System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47)), EngineTimeout).Result,
            "El lienzo no se desplazó con la herramienta Mano.");
        Assert.AreEqual(string.Empty, Session.FindById("SelectionStatus")?.Properties.Name.ValueOrDefault ?? string.Empty);

        Session.GetById("ToolSelect").Click();
    }

    [TestMethod]
    public void ArrastrarElSolLoMueveYDeshacerLoDevuelve()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);

        // Doble clic entra en g#fondo y selecciona el sol; arrastrarlo lo mueve 150 px a la izquierda.
        Mouse.DoubleClick(sun);
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);
        Mouse.Drag(sun, new System.Drawing.Point(sun.X - 150, sun.Y));

        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(new System.Drawing.Point(sun.X - 150, sun.Y)), orange), EngineTimeout).Result,
            "El sol no se movió al arrastrarlo.");
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Deshacer no se activó tras mover.");

        undo.Click();

        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), orange), EngineTimeout).Result,
            "Deshacer no devolvió el sol a su sitio.");
        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, "Tras deshacer, Deshacer sigue activo.");
    }

    [TestMethod]
    public void EscribirXEnElPanelMueveElSolYSePuedeDeshacer()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);
        Mouse.DoubleClick(sun);
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);

        // La caja del sol empieza en x = 248 (cx 300, r 52). Con x = 148 se mueve 100 unidades a la izquierda.
        var x = Retry.WhileNull(() => Session.FindById("SelectionX"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el campo X del panel de propiedades.");
        Assert.IsTrue(Retry.WhileFalse(() => Math.Abs(x.Patterns.RangeValue.Pattern.Value - 248) < 0.01, EngineTimeout).Result, "El panel no muestra la X del sol.");
        x.Patterns.RangeValue.Pattern.SetValue(148);

        var moved = AppSession.SamplePoint(canvas, 200, 96);
        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(moved), orange), EngineTimeout).Result,
            "El sol no se movió al cambiar X en el panel.");

        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Deshacer no se activó.");
        undo.Click();
        Assert.IsTrue(
            Retry.WhileFalse(() => Math.Abs(x.Patterns.RangeValue.Pattern.Value - 248) < 0.01, EngineTimeout).Result,
            "Deshacer no devolvió la X del sol a 248.");
        Assert.IsTrue(Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), orange), EngineTimeout).Result);
    }

    [TestMethod]
    public void ClicFueraDelDocumentoVaciaLaSeleccion()
    {
        ClickSample(300, 96);
        Session.WaitForName("SelectionStatus", name => name == "g#fondo", EngineTimeout);

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
    /// <remarks>
    /// Se comprueba por el color de la pantalla y no con UI Automation: si se consulta el árbol de
    /// accesibilidad del WebView2 antes de que cargue el motor, su contenido deja de aparecer en él
    /// aunque se vea en pantalla.
    /// </remarks>
    [TestMethod]
    public void UnDocumentoAbiertoAntesDeQueCargueElMotorSeMuestraAlCargar()
    {
        Session.GetById("HelpMenu").Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp("OpenSampleMenuItem"), TimeSpan.FromSeconds(10)).Result;
        Assert.IsNotNull(item, "No aparece el menú del documento de ejemplo.");
        item.Patterns.Invoke.Pattern.Invoke();

        WaitForEngine();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);
        var shown = Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), orange), TimeSpan.FromSeconds(20), TimeSpan.FromMilliseconds(250)).Result;

        Assert.IsTrue(shown, $"El sol del documento de ejemplo no se ve en el lienzo: el color es {AppSession.ColorAt(sun)}.");
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

    private void InvokeViewMenu(string automationId)
    {
        Session.GetById("ViewMenu").Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp(automationId), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException($"No aparece {automationId} en el menú Ver.");
        item.Patterns.Invoke.Pattern.Invoke();
    }

    private void ClickSample(double svgX, double svgY)
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.Click(AppSession.SamplePoint(canvas, svgX, svgY));
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
