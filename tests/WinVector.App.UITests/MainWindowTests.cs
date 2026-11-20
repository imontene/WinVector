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

    /// <summary>
    /// Espera a que arranque el motor. En un equipo recién creado de la CI, el primer WebView2 de la
    /// sesión puede tardar más de 20 s en arrancar; las demás esperas siguen en 20 s.
    /// </summary>
    private static readonly TimeSpan EngineStartTimeout = TimeSpan.FromSeconds(60);

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
            EngineStartTimeout,
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

        // Doble clic entra en g#fondo y selecciona el sol; arrastrarlo lo mueve 80 px a la derecha, hacia
        // el cielo despejado (a la izquierda quedaría debajo de la tarjeta, que se pinta encima).
        Mouse.DoubleClick(sun);
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);
        var target = new System.Drawing.Point(sun.X + 80, sun.Y);
        Mouse.Drag(sun, target);

        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(target), orange), EngineTimeout).Result,
            "El sol no se movió al arrastrarlo.");
        // Donde estaba el centro ya no está el sol (su radio en pantalla es de unos 69 px).
        Assert.IsFalse(AppSession.IsClose(AppSession.ColorAt(new System.Drawing.Point(sun.X - 20, sun.Y)), orange));
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Deshacer no se activó tras mover.");

        undo.Click();

        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), orange), EngineTimeout).Result,
            "Deshacer no devolvió el sol a su sitio.");
        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, "Tras deshacer, Deshacer sigue activo.");
    }

    [TestMethod]
    public void ConElRectanguloArrastrarCreaUnRectanguloYDeshacerLoQuita()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;

        Session.GetById("ToolRectangle").Click();
        // En el cielo despejado, a la derecha de la tarjeta y a la izquierda del sol.
        Mouse.Drag(AppSession.SamplePoint(canvas, 205, 10), AppSession.SamplePoint(canvas, 240, 40));

        // La forma nueva queda seleccionada; no tiene identificador.
        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("rect", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("rect", StringComparison.Ordinal), $"No se creó el rectángulo: la selección es '{status}'.");
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Deshacer no se activó tras crear el rectángulo.");

        undo.Click();

        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, "Tras deshacer, Deshacer sigue activo.");
        Assert.AreEqual(string.Empty, Session.WaitForName("SelectionStatus", string.IsNullOrEmpty, EngineTimeout), "El rectángulo sigue seleccionado tras deshacer.");
    }

    [TestMethod]
    public void ConLaElipseYMayusSeDibujaUnCirculo()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;

        Session.GetById("ToolEllipse").Click();
        // Un clic sin arrastrar no crea nada, pero hace que la página reciba el teclado y vea Mayús.
        Mouse.Click(new System.Drawing.Point(canvas.X + 4, canvas.Y + 4));
        // El teclado llega a la página por WebView2 y el ratón por WinUI: con la entrada sintética, el
        // arrastre a veces se adelanta a la tecla. Se intenta hasta tres veces, en sitios distintos.
        var status = string.Empty;
        for (var attempt = 0; attempt < 3 && !status.StartsWith("circle", StringComparison.Ordinal); attempt++)
        {
            using (Keyboard.Pressing(VirtualKeyShort.SHIFT))
            {
                Thread.Sleep(500);
                Mouse.Drag(AppSession.SamplePoint(canvas, 205, 10 + (attempt * 12)), AppSession.SamplePoint(canvas, 235, 18 + (attempt * 12)));
                Thread.Sleep(200);
            }

            status = Session.WaitForName("SelectionStatus", name => name.StartsWith("circle", StringComparison.Ordinal), TimeSpan.FromSeconds(5));
        }

        Assert.IsTrue(status.StartsWith("circle", StringComparison.Ordinal), $"No se creó un círculo: la selección es '{status}'.");
    }

    [TestMethod]
    public void ConLaLineaArrastrarCreaUnaLineaSeleccionada()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;

        Session.GetById("ToolLine").Click();
        Mouse.Drag(AppSession.SamplePoint(canvas, 205, 10), AppSession.SamplePoint(canvas, 240, 40));

        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("line", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("line", StringComparison.Ordinal), $"No se creó la línea: la selección es '{status}'.");
    }

    [TestMethod]
    public void ConLaEstrellaArrastrarCreaUnaEstrellaSeleccionada()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;

        Session.GetById("ToolStar").Click();
        // Desde el centro hasta una punta, en el cielo despejado.
        Mouse.Drag(AppSession.SamplePoint(canvas, 225, 25), AppSession.SamplePoint(canvas, 225, 8));

        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("polygon", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("polygon", StringComparison.Ordinal), $"No se creó la estrella: la selección es '{status}'.");
    }

    [TestMethod]
    public void ElRadioDelSolSeCambiaEnLaSeccionDeLaForma()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 300, 96));
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);

        var radius = Retry.WhileNull(() => Session.FindById("ShapeR"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el campo Radio de la forma.");
        Assert.IsTrue(Retry.WhileFalse(() => Math.Abs(radius.Patterns.RangeValue.Pattern.Value - 52) < 0.01, EngineTimeout).Result, "El panel no muestra el radio del sol.");
        radius.Patterns.RangeValue.Pattern.SetValue(70);

        // A 60 unidades del centro: fuera del sol con radio 52, dentro con 70.
        var edge = AppSession.SamplePoint(canvas, 360, 96);
        Assert.IsTrue(Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(edge), orange), EngineTimeout).Result, "El sol no creció al cambiar el radio.");

        Session.GetById("UndoButton").Click();
        Assert.IsTrue(
            Retry.WhileFalse(() => Math.Abs(radius.Patterns.RangeValue.Pattern.Value - 52) < 0.01, EngineTimeout).Result,
            "Deshacer no devolvió el radio a 52.");
    }

    [TestMethod]
    public void ConvertirElSolEnTrazadoDesdeElMenuTrazado()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);
        Mouse.DoubleClick(sun);
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);

        InvokeMenu("PathMenu", "MenuPathObjectToPath");

        Assert.IsTrue(
            Session.WaitForName("SelectionStatus", name => name.StartsWith("path#sol", StringComparison.Ordinal), EngineTimeout).StartsWith("path#sol", StringComparison.Ordinal),
            "El sol no pasó a ser un trazado.");
        Assert.IsTrue(AppSession.IsClose(AppSession.ColorAt(sun), orange), "El sol cambió de aspecto al convertirlo.");
    }

    [TestMethod]
    public void ConVerticesUnaEsquinaDeLaTarjetaSeArrastraYPasaAPoligono()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        // Doble clic entra en g#contenido y selecciona la tarjeta.
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 120, 70));
        Session.WaitForName("SelectionStatus", name => name.StartsWith("rect#tarjeta", StringComparison.Ordinal), EngineTimeout);

        Session.GetById("ToolVertex").Click();
        Mouse.Drag(AppSession.SamplePoint(canvas, 198, 146), AppSession.SamplePoint(canvas, 225, 170));

        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("polygon#tarjeta", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("polygon#tarjeta", StringComparison.Ordinal), $"La tarjeta no pasó a ser un polígono: la selección es '{status}'.");
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Deshacer no se activó.");
        undo.Click();
        Assert.IsTrue(
            Session.WaitForName("SelectionStatus", name => name.StartsWith("rect#tarjeta", StringComparison.Ordinal), EngineTimeout).StartsWith("rect#tarjeta", StringComparison.Ordinal),
            "Deshacer no devolvió el rectángulo.");
    }

    [TestMethod]
    public void ConLaPlumaTresClicsYCerrarCreanUnPoligono()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;

        Session.GetById("ToolPen").Click();
        // En el cielo despejado: tres vértices y clic en el primero para cerrar.
        Mouse.Click(AppSession.SamplePoint(canvas, 205, 10));
        Mouse.Click(AppSession.SamplePoint(canvas, 240, 10));
        Mouse.Click(AppSession.SamplePoint(canvas, 222, 40));
        Mouse.Click(AppSession.SamplePoint(canvas, 205, 10));

        var status = Session.WaitForName("SelectionStatus", name => name.StartsWith("polygon", StringComparison.Ordinal), EngineTimeout);
        Assert.IsTrue(status.StartsWith("polygon", StringComparison.Ordinal), $"No se creó el polígono: la selección es '{status}'.");
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
    public void AgruparDesdeElMenuObjetoYDeshacer()
    {
        ClickSample(300, 96);
        Session.WaitForName("SelectionStatus", name => name == "g#fondo", EngineTimeout);
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_A);
        Session.WaitForName("SelectionStatus", name => name.StartsWith('2'), EngineTimeout);

        Session.GetById("ObjectMenu").Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp("MenuObjectGroup"), TimeSpan.FromSeconds(10)).Result
            ?? throw new AssertFailedException("No aparece Objeto > Agrupar.");
        item.Patterns.Invoke.Pattern.Invoke();

        // El grupo nuevo no tiene id: la barra de estado dice "g".
        Assert.AreEqual("g", Session.WaitForName("SelectionStatus", name => name == "g", EngineTimeout));

        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result);
        undo.Click();
        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, "Deshacer agrupar no dejó el documento como estaba.");
    }

    [TestMethod]
    public void CopiarYPegarDesdeElMenuEditarYDeshacer()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 300, 96));
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);

        InvokeMenu("EditMenu", "MenuEditCopy");
        InvokeMenu("EditMenu", "MenuEditPaste");

        // La copia pegada lleva un id nuevo: el sol original sigue llamándose "sol".
        var pasted = Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol-2", StringComparison.Ordinal), EngineTimeout);
        StringAssert.StartsWith(pasted, "circle#sol-2", "No se pegó la copia del sol.");

        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result);
        undo.Click();
        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, "Deshacer pegar no dejó el documento como estaba.");
    }

    [TestMethod]
    public void QuitarElRellenoDelSolDesdeElPanelYDeshacer()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var sun = AppSession.SamplePoint(canvas, 300, 96);
        var orange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);
        Mouse.DoubleClick(sun);
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);

        // El botón de relleno muestra el color del sol.
        var fill = Retry.WhileNull(() => Session.FindById("FillButton"), EngineTimeout).Result
            ?? throw new AssertFailedException("No aparece el botón de relleno.");
        Assert.AreEqual("#FFB547", Session.WaitForName("FillButton", name => name == "#FFB547", EngineTimeout));

        fill.Click();
        var none = Retry.WhileNull(() => Session.FindInApp("FillNone"), TimeSpan.FromSeconds(10)).Result
            ?? throw new AssertFailedException("No aparece Sin relleno.");
        none.Patterns.Invoke.Pattern.Invoke();

        Assert.IsTrue(
            Retry.WhileFalse(() => !AppSession.IsClose(AppSession.ColorAt(sun), orange), EngineTimeout).Result,
            "El sol sigue relleno.");
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result);
        undo.Click();
        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(sun), orange), EngineTimeout).Result,
            "Deshacer no devolvió el relleno al sol.");
    }

    [TestMethod]
    public void EscribirDeshacerEnLaPaletaDeshaceElUltimoCambio()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 300, 96));
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_D);
        var undo = Session.GetById("UndoButton");
        Assert.IsTrue(Retry.WhileFalse(() => undo.IsEnabled, EngineTimeout).Result, "Ctrl+D no duplicó el sol.");

        // "Deshacer" o "Undo": se escribe en el idioma de la interfaz.
        var query = undo.Name.StartsWith("Des", StringComparison.Ordinal) ? "deshacer" : "undo";
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_K);
        var search = Session.GetById("CommandSearch");
        Assert.IsTrue(Retry.WhileFalse(() => search.Properties.HasKeyboardFocus.ValueOrDefault || search.FindFirstDescendant(cf => cf.ByControlType(ControlType.Edit))?.Properties.HasKeyboardFocus.ValueOrDefault == true, TimeSpan.FromSeconds(5)).Result, "Ctrl+K no enfocó la paleta de comandos.");
        Keyboard.Type(query);
        Thread.Sleep(300);
        Keyboard.Press(VirtualKeyShort.ENTER);

        Assert.IsTrue(Retry.WhileFalse(() => !undo.IsEnabled, EngineTimeout).Result, $"Escribir \"{query}\" e Intro no deshizo el último cambio.");
    }

    /// <summary>Espera a que la aplicación guarde las copias de recuperación (cada 10 s, #24).</summary>
    private static readonly TimeSpan RecoveryWait = TimeSpan.FromSeconds(14);

    /// <summary>
    /// Duplica el sol (Ctrl+D lo pone 10 unidades a la derecha y abajo). El punto (357, 96) del ejemplo
    /// queda fuera del sol original pero dentro de la copia: es naranja solo si existe la copia.
    /// </summary>
    private System.Drawing.Point DuplicateSun()
    {
        WaitForEngine();
        Session.OpenSample();
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        Mouse.DoubleClick(AppSession.SamplePoint(canvas, 300, 96));
        Session.WaitForName("SelectionStatus", name => name.StartsWith("circle#sol", StringComparison.Ordinal), EngineTimeout);
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_D);
        var copy = AppSession.SamplePoint(canvas, 357, 96);
        Assert.IsTrue(Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(copy), SunOrange), EngineTimeout).Result, "Ctrl+D no duplicó el sol.");
        return copy;
    }

    private static readonly System.Drawing.Color SunOrange = System.Drawing.Color.FromArgb(0xff, 0xb5, 0x47);

    private bool SomeTabIsModified() =>
        Tabs().Any(tab => tab.Name.EndsWith('•'));

    [TestMethod]
    public void SiSeMataLaAplicacionConCambiosSeOfreceRecuperarlos()
    {
        DuplicateSun();
        Thread.Sleep(RecoveryWait);

        Session.Kill();
        Session.Dispose();
        _session = AppSession.Start(keepRecovery: true);

        var dialog = Retry.WhileNull(() => Session.FindInApp("RecoveryDialog"), EngineStartTimeout, TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException("Al volver a abrir no se ofrece recuperar los documentos.");
        var recover = dialog.FindFirstDescendant(cf => cf.ByAutomationId("PrimaryButton"))
            ?? throw new AssertFailedException("El diálogo de recuperación no tiene el botón Recuperar.");
        recover.Patterns.Invoke.Pattern.Invoke();

        WaitForEngine();
        Assert.IsTrue(Retry.WhileFalse(SomeTabIsModified, EngineTimeout).Result, "El documento recuperado no aparece con cambios sin guardar.");
        var canvas = Session.GetById("EngineCanvas").BoundingRectangle;
        var copy = AppSession.SamplePoint(canvas, 357, 96);
        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(copy), SunOrange), EngineTimeout).Result,
            "El documento recuperado no tiene la copia del sol.");
    }

    [TestMethod]
    public void SiFallaElProcesoDelLienzoSeRecargaConLosCambios()
    {
        var copy = DuplicateSun();
        Thread.Sleep(RecoveryWait);
        var ready = Session.FindById("EngineStatus")?.Properties.Name.ValueOrDefault ?? string.Empty;

        Assert.IsGreaterThan(0, Session.KillCanvasRenderers(), "No se encontró el proceso de renderizado del lienzo.");

        // La aplicación avisa, el estado deja de ser "Listo" y vuelve cuando el motor recarga.
        var notice = Retry.WhileNull(() => Session.FindInApp("ErrorDialog"), EngineStartTimeout, TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException("No se avisó de que el lienzo dejó de funcionar.");
        var ok = notice.FindFirstDescendant(cf => cf.ByAutomationId("CloseButton"))
            ?? throw new AssertFailedException("El aviso no tiene el botón Aceptar.");
        ok.Patterns.Invoke.Pattern.Invoke();
        Assert.AreEqual(ready, Session.WaitForName("EngineStatus", name => name == ready, EngineStartTimeout), "El motor no volvió a cargar.");

        Assert.IsTrue(
            Retry.WhileFalse(() => AppSession.IsClose(AppSession.ColorAt(copy), SunOrange), EngineTimeout).Result,
            "Tras recargar, el documento no tiene la copia del sol (la última copia de recuperación).");
        Assert.IsTrue(SomeTabIsModified(), "Tras recargar, el documento debe seguir con cambios sin guardar.");
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

        // Y está en el árbol de accesibilidad: un lector de pantalla lo encuentra (#40).
        var text = Retry.WhileNull(() => Session.FindSampleText(), TimeSpan.FromSeconds(20), TimeSpan.FromMilliseconds(250)).Result;
        Assert.IsNotNull(text, "El documento se ve, pero su contenido no aparece en el árbol de UI Automation.");
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
            Retry.WhileFalse(() => !string.IsNullOrEmpty(Session.FindById("EngineStatus")?.Properties.HelpText.ValueOrDefault), EngineStartTimeout).Result,
            "El motor no terminó de cargar.");

    private void InvokeMenu(string menu, string automationId)
    {
        Session.GetById(menu).Patterns.ExpandCollapse.Pattern.Expand();
        var item = Retry.WhileNull(() => Session.FindInApp(automationId), TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(250)).Result
            ?? throw new AssertFailedException($"No aparece {automationId} en el menú.");
        Assert.IsTrue(Retry.WhileFalse(() => item.IsEnabled, EngineTimeout).Result, $"{automationId} está desactivado.");
        item.Patterns.Invoke.Pattern.Invoke();
    }

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
