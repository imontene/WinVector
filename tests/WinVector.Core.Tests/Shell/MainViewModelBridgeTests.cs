using Microsoft.Extensions.Time.Testing;
using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class MainViewModelBridgeTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly FakeTimeProvider _time = new();
    private readonly MainViewModel _viewModel;
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly FakeEngine _engine;

    public MainViewModelBridgeTests()
    {
        _viewModel = new MainViewModel(MainViewModelTests.Texts, timeProvider: _time);
        _bridge = new BridgeClient(_transport, timeProvider: _time);
        _attachment = _viewModel.AttachBridge(_bridge);
        _engine = new FakeEngine(_transport);
    }

    public void Dispose()
    {
        _attachment.Dispose();
        _bridge.Dispose();
    }

    private async Task ReadyAsync()
    {
        _engine.Ready();
        await _viewModel.EngineWork;
        await _viewModel.LatencyMeasurement;
    }

    [TestMethod]
    public async Task AlCargarElMotorCargaLasPestañasYActivaLaSeleccionada()
    {
        await ReadyAsync();

        Assert.AreEqual("view.setOptions | document.load d1 | document.activate d1 | app.ping", string.Join(" | ", _engine.Commands));
        Assert.IsTrue(_viewModel.Documents[0].IsLoaded);
        Assert.AreEqual("d1", _engine.ActiveDocument);
        Assert.IsTrue(_viewModel.IsEngineReady);
    }

    [TestMethod]
    public async Task UnDocumentoAbiertoAntesDeQueCargueElMotorSeCargaYSeActivaAlCargar()
    {
        _viewModel.OpenDocument("Ejemplo", "<svg/>");

        await ReadyAsync();

        // El ping se envía en paralelo; su posición depende de cuándo responde el motor.
        Assert.AreEqual(
            "view.setOptions | document.load d1 | document.load d2 | document.activate d2",
            string.Join(" | ", _engine.Commands.Where(c => c != "app.ping")));
        Assert.AreEqual("d2", _engine.ActiveDocument);
    }

    [TestMethod]
    public async Task UnaPestañaNuevaSeCargaYSeActiva()
    {
        await ReadyAsync();
        _engine.Commands.Clear();

        _viewModel.NewDocument();
        await _viewModel.EngineWork;

        Assert.AreEqual("document.load d2 | document.activate d2", string.Join(" | ", _engine.Commands));
        Assert.AreEqual("d2", _engine.ActiveDocument);
    }

    [TestMethod]
    public async Task CambiarDePestañaActivaSuDocumentoYVaciaLaSeleccion()
    {
        await ReadyAsync();
        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        _transport.SendEvent("selection.changed", """{"documentId":"d2","items":[{"id":"sol","tagName":"circle"}],"bounds":null,"scope":null}""");

        _viewModel.SelectedDocument = _viewModel.Documents[0];
        await _viewModel.EngineWork;

        Assert.AreEqual("d1", _engine.ActiveDocument);
        Assert.AreEqual(string.Empty, _viewModel.SelectionSummary);
    }

    [TestMethod]
    public async Task CerrarUnaPestañaCierraSuDocumento()
    {
        await ReadyAsync();
        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        _engine.Commands.Clear();

        _viewModel.CloseDocument(_viewModel.Documents[1]);
        await _viewModel.EngineWork;

        Assert.AreEqual("document.close d2 | document.activate d1", string.Join(" | ", _engine.Commands));
    }

    [TestMethod]
    public async Task UnDocumentoSinCambiosSeRecuperaIdentico()
    {
        await ReadyAsync();
        var svg = """<svg xmlns="http://www.w3.org/2000/svg"><!-- hola --><rect id="a"/></svg>""";

        var document = _viewModel.OpenDocument("ejemplo.svg", svg);
        var content = await _viewModel.SerializeAsync(document);

        Assert.AreEqual(svg, content.Svg);
    }

    [TestMethod]
    public async Task UnSvgNoValidoQuedaSinCargarConElMotivo()
    {
        await ReadyAsync();
        _engine.InvalidSvgs.Add("<svg");

        var document = _viewModel.OpenDocument("roto.svg", "<svg");
        await _viewModel.EngineWork;

        Assert.IsFalse(document.IsLoaded);
        Assert.AreEqual("XML no válido", document.LoadError);
        Assert.IsFalse(_engine.Commands.Contains("document.activate d2"));
    }

    [TestMethod]
    public async Task LosCambiosDelDocumentoMarcanLaPestañaComoModificada()
    {
        await ReadyAsync();
        var document = _viewModel.Documents[0];
        Assert.IsFalse(document.IsModified);

        _transport.SendEvent("document.changed", """{"documentId":"d1","revision":3}""");

        Assert.AreEqual(3, document.Revision);
        Assert.IsTrue(document.IsModified);
    }

    [TestMethod]
    public async Task SinPasosNoSePuedeDeshacerNiRehacer()
    {
        await ReadyAsync();

        Assert.IsFalse(_viewModel.CanUndo);
        Assert.IsFalse(_viewModel.CanRedo);
        Assert.IsFalse(_viewModel.UndoCommand.CanExecute(null));
        Assert.AreEqual("Deshacer", _viewModel.UndoLabel);
        Assert.AreEqual("Rehacer", _viewModel.RedoLabel);
    }

    [TestMethod]
    public async Task DeshacerYRehacerSiguenElHistorialDelDocumentoActivo()
    {
        await ReadyAsync();
        var document = _viewModel.Documents[0];
        _engine.Modify("d1", "<svg>1</svg>", "move");
        Assert.IsTrue(_viewModel.UndoCommand.CanExecute(null));
        Assert.AreEqual("Deshacer move", _viewModel.UndoLabel);
        Assert.IsTrue(document.IsModified);

        await _viewModel.UndoAsync();

        Assert.IsTrue(_engine.Commands.Contains("history.undo d1"));
        Assert.IsFalse(_viewModel.CanUndo);
        Assert.IsTrue(_viewModel.RedoCommand.CanExecute(null));
        Assert.AreEqual("Rehacer move", _viewModel.RedoLabel);
        Assert.IsFalse(document.IsModified, "Deshacer hasta lo guardado deja el documento sin cambios.");

        await _viewModel.RedoAsync();

        Assert.AreEqual("<svg>1</svg>", _engine.DocumentText("d1"));
        Assert.IsTrue(_viewModel.CanUndo);
        Assert.IsFalse(_viewModel.CanRedo);
        Assert.IsTrue(document.IsModified);
    }

    [TestMethod]
    public async Task VariasPulsacionesSeguidasDeshacenUnPasoCadaUna()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg>1</svg>");
        _engine.Modify("d1", "<svg>2</svg>");
        _engine.Modify("d1", "<svg>3</svg>");

        _viewModel.UndoCommand.Execute(null);
        _viewModel.UndoCommand.Execute(null);
        await _viewModel.EngineWork;

        Assert.AreEqual("<svg>1</svg>", _engine.DocumentText("d1"));
        Assert.IsTrue(_viewModel.CanUndo);
        Assert.IsTrue(_viewModel.CanRedo);
    }

    [TestMethod]
    public async Task ElHistorialEsDeCadaPestaña()
    {
        await ReadyAsync();
        _engine.Modify("d1", "<svg>1</svg>", "move");
        _viewModel.NewDocument();
        await _viewModel.EngineWork;

        Assert.IsFalse(_viewModel.CanUndo, "La pestaña nueva no tiene historial.");
        _engine.Commands.Clear();
        await _viewModel.UndoAsync();
        Assert.IsFalse(_engine.Commands.Contains("history.undo d1"));

        _viewModel.SelectedDocument = _viewModel.Documents[0];
        Assert.IsTrue(_viewModel.CanUndo);
        Assert.AreEqual("Deshacer move", _viewModel.UndoLabel);
    }

    [TestMethod]
    public async Task AvisaDelCambioDeLasOrdenesDeDeshacer()
    {
        await ReadyAsync();
        var changed = new List<string?>();
        _viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        var canExecuteChanged = 0;
        _viewModel.UndoCommand.CanExecuteChanged += (_, _) => canExecuteChanged++;

        _engine.Modify("d1", "<svg>1</svg>");

        foreach (var property in (string[])["CanUndo", "CanRedo", "UndoLabel", "RedoLabel"])
        {
            CollectionAssert.Contains(changed, property);
        }
        Assert.IsGreaterThan(0, canExecuteChanged);
    }

    [TestMethod]
    public async Task SeleccionarTodoLoPideAlMotorParaElDocumentoActivo()
    {
        Assert.IsFalse(_viewModel.SelectAllCommand.CanExecute(null), "Sin motor no hay nada que seleccionar.");
        await ReadyAsync();
        _engine.Commands.Clear();

        Assert.IsTrue(_viewModel.SelectAllCommand.CanExecute(null));
        await _viewModel.SelectAllAsync();

        Assert.AreEqual("selection.selectAll d1", string.Join(" | ", _engine.Commands));
    }

    [TestMethod]
    public async Task ElZoomDelDocumentoActivoSeMuestraEnLaBarraDeEstado()
    {
        await ReadyAsync();
        _transport.SendEvent("viewport.changed", """{"documentId":"d1","zoom":1.5}""");
        Assert.AreEqual("150 %", _viewModel.ZoomText);

        await _viewModel.ZoomActualAsync();
        Assert.AreEqual("100 %", _viewModel.ZoomText);
        Assert.IsTrue(_engine.Commands.Contains("view.zoom d1"));

        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        Assert.AreEqual("100 %", _viewModel.ZoomText, "Cada pestaña tiene su zoom.");
        _transport.SendEvent("viewport.changed", """{"documentId":"d1","zoom":3}""");
        Assert.AreEqual("100 %", _viewModel.ZoomText);
        _viewModel.SelectedDocument = _viewModel.Documents[0];
        Assert.AreEqual("300 %", _viewModel.ZoomText);
    }

    [TestMethod]
    public async Task LasOpcionesDeVistaSeEnvianAlMotor()
    {
        await ReadyAsync();
        _engine.Commands.Clear();

        _viewModel.ShowGrid = true;
        _viewModel.ShowRulers = false;
        await _viewModel.EngineWork;

        Assert.AreEqual("view.setOptions | view.setOptions", string.Join(" | ", _engine.Commands));
    }

    [TestMethod]
    public async Task LaHerramientaSigueAlLienzoYALaAplicacion()
    {
        await ReadyAsync();
        _transport.SendEvent("tool.changed", """{"tool":"hand"}""");
        Assert.AreEqual(ToolName.Hand, _viewModel.ActiveTool);

        _engine.Commands.Clear();
        await _viewModel.SelectToolAsync(ToolName.Zoom);
        Assert.AreEqual(ToolName.Zoom, _viewModel.ActiveTool);
        Assert.AreEqual("tool.select", string.Join(" | ", _engine.Commands));
    }

    [TestMethod]
    public async Task LaMesaDeTrabajoSeEditaConValoresValidos()
    {
        await ReadyAsync();
        _transport.SendEvent("artboard.changed", """{"documentId":"d1","width":"800","height":"600","viewBox":{"x":0,"y":0,"width":400,"height":300}}""");
        Assert.AreEqual("800", _viewModel.CurrentArtboard?.Width);

        Assert.IsFalse(_viewModel.ApplyArtboard("ancho", "600", "0 0 400 300"));
        Assert.IsFalse(_viewModel.ApplyArtboard("800", "600", "0 0 400"));
        Assert.IsTrue(_viewModel.ApplyArtboard("800", "600", "0 0 400 300"), "Sin cambios no hace falta enviar nada.");
        await _viewModel.EngineWork;
        Assert.IsEmpty(_engine.ArtboardsSet);

        Assert.IsTrue(_viewModel.ApplyArtboard(" 210MM ", "", "0,0,210,297"));
        await _viewModel.EngineWork;

        Assert.AreEqual("""{"documentId":"d1","width":"210mm","height":null,"viewBox":{"x":0,"y":0,"width":210,"height":297}}""", _engine.ArtboardsSet.Single());
        Assert.AreEqual("210mm", _viewModel.CurrentArtboard?.Width);
    }

    [TestMethod]
    public async Task LosAtajosQueEnviaElLienzoEjecutanLasOrdenesDeLaVentana()
    {
        await ReadyAsync();

        _transport.SendEvent("keyboard.shortcut", """{"key":"n","ctrlKey":true,"shiftKey":false,"altKey":false}""");
        Assert.HasCount(2, _viewModel.Documents);

        _transport.SendEvent("keyboard.shortcut", """{"key":"r","ctrlKey":true,"shiftKey":false,"altKey":false}""");
        Assert.IsFalse(_viewModel.ShowRulers);

        Assert.IsFalse(await _viewModel.HandleShortcutAsync(new KeyboardShortcut("q", true, false, false)));
        Assert.IsFalse(await _viewModel.HandleShortcutAsync(new KeyboardShortcut("n", false, false, false)));
        Assert.HasCount(2, _viewModel.Documents);
    }

    private void SelectSun(double? rotation = 12.346)
    {
        var rotationJson = rotation is { } r ? $",\"rotation\":{r.ToString(System.Globalization.CultureInfo.InvariantCulture)}" : string.Empty;
        _transport.SendEvent(
            "selection.changed",
            $$"""{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}],"bounds":{"x":248.004,"y":44,"width":104,"height":52.5},"scope":null{{rotationJson}}}""");
    }

    [TestMethod]
    public async Task ElPanelMuestraLaCajaYElGiroDeLaSeleccion()
    {
        await ReadyAsync();
        Assert.IsTrue(double.IsNaN(_viewModel.SelectionX));

        SelectSun();

        Assert.AreEqual(248, _viewModel.SelectionX);
        Assert.AreEqual(44, _viewModel.SelectionY);
        Assert.AreEqual(104, _viewModel.SelectionWidth);
        Assert.AreEqual(52.5, _viewModel.SelectionHeight);
        Assert.AreEqual(12.35, _viewModel.SelectionRotation);
        Assert.IsTrue(_viewModel.CanRotateSelection);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"a","tagName":"rect"},{"id":"b","tagName":"rect"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null}""");
        Assert.IsFalse(_viewModel.CanRotateSelection, "Con varios objetos no se gira desde el panel.");

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[],"bounds":null,"scope":null}""");
        Assert.IsTrue(double.IsNaN(_viewModel.SelectionWidth));
    }

    [TestMethod]
    public async Task CambiarUnValorEnviaSoloEseCampo()
    {
        await ReadyAsync();
        SelectSun();

        Assert.IsTrue(_viewModel.SetSelectionGeometry(GeometryField.X, 100));
        Assert.IsTrue(_viewModel.SetSelectionGeometry(GeometryField.Rotation, 45));
        await _viewModel.EngineWork;

        Assert.AreEqual(
            """{"documentId":"d1","x":100,"y":null,"width":null,"height":null,"rotation":null}""" + " | "
            + """{"documentId":"d1","x":null,"y":null,"width":null,"height":null,"rotation":45}""",
            string.Join(" | ", _engine.GeometriesSet));
    }

    [TestMethod]
    public async Task ConLaProporcionBloqueadaCambianAnchoYAlto()
    {
        await ReadyAsync();
        SelectSun();
        _viewModel.LockAspectRatio = true;

        Assert.IsTrue(_viewModel.SetSelectionGeometry(GeometryField.Width, 208));
        await _viewModel.EngineWork;

        Assert.AreEqual("""{"documentId":"d1","x":null,"y":null,"width":208,"height":105,"rotation":null}""", _engine.GeometriesSet.Single());
    }

    [TestMethod]
    [DataRow(GeometryField.X, 248)]
    [DataRow(GeometryField.Width, 0)]
    [DataRow(GeometryField.Height, -5)]
    [DataRow(GeometryField.Y, double.NaN)]
    public async Task UnValorIgualONoValidoNoCambiaNada(GeometryField field, double value)
    {
        await ReadyAsync();
        SelectSun();
        var refreshed = new List<string?>();
        _viewModel.PropertyChanged += (_, e) => refreshed.Add(e.PropertyName);

        Assert.IsFalse(_viewModel.SetSelectionGeometry(field, value));
        await _viewModel.EngineWork;

        Assert.IsEmpty(_engine.GeometriesSet);
        CollectionAssert.Contains(refreshed, "SelectionX", "El panel debe volver a mostrar el valor actual.");
    }

    [TestMethod]
    public async Task SinUnSoloObjetoNoSeGira()
    {
        await ReadyAsync();
        SelectSun(rotation: null);
        Assert.IsFalse(_viewModel.SetSelectionGeometry(GeometryField.Rotation, 30));
    }

    [TestMethod]
    public async Task MideLaLatenciaDelPuente()
    {
        _engine.BeforePingResponse = () => _time.Advance(TimeSpan.FromMilliseconds(4));

        await ReadyAsync();

        Assert.AreEqual(TimeSpan.FromMilliseconds(4), _viewModel.BridgeLatency);
    }

    [TestMethod]
    public async Task SiElPingFallaLaLatenciaQuedaVacia()
    {
        _transport.OnPosted = null;
        _engine.Ready();
        _time.Advance(BridgeClient.DefaultTimeout);
        await _viewModel.LatencyMeasurement;

        Assert.IsNull(_viewModel.BridgeLatency);
        Assert.IsTrue(_viewModel.IsEngineReady);
    }

    [TestMethod]
    public void UnMotorConOtroProtocoloSeMarcaComoIncompatible()
    {
        _transport.SendEvent("engine.ready", """{"engineVersion":"9.0.0","protocolVersion":99}""", protocolVersion: 99);

        Assert.IsFalse(_viewModel.IsEngineReady);
        Assert.AreEqual($"Protocolo 99, se esperaba {BridgeProtocol.Version}", _viewModel.EngineStatus);
        Assert.IsEmpty(_engine.Commands);
    }

    [TestMethod]
    [DataRow("""{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}],"bounds":null,"scope":null}""", "circle#sol")]
    [DataRow("""{"documentId":"d1","items":[{"id":null,"tagName":"path"}],"bounds":null,"scope":null}""", "path")]
    [DataRow("""{"documentId":"d1","items":[{"id":"a","tagName":"rect"},{"id":"b","tagName":"rect"}],"bounds":null,"scope":null}""", "2 objetos")]
    [DataRow("""{"documentId":"d1","items":[],"bounds":null,"scope":null}""", "")]
    [DataRow("""{"documentId":"otro","items":[{"id":"x","tagName":"rect"}],"bounds":null,"scope":null}""", "previo")]
    [DataRow("""{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}],"bounds":{"x":1,"y":2,"width":3,"height":4},"scope":{"id":"fondo","tagName":"g"}}""", "circle#sol en g#fondo")]
    [DataRow("""{"documentId":"d1","items":[],"bounds":null,"scope":{"id":null,"tagName":"g"}}""", "En g")]
    public void ResumeLaSeleccionDelDocumentoActivo(string payload, string expected)
    {
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"previo","tagName":"g"}],"bounds":null,"scope":null}""");
        _transport.SendEvent("selection.changed", payload);

        Assert.AreEqual(expected == "previo" ? "g#previo" : expected, _viewModel.SelectionSummary);
    }

    [TestMethod]
    public void AlDesconectarseDejaDeActualizarse()
    {
        _attachment.Dispose();
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}],"bounds":null,"scope":null}""");

        Assert.AreEqual(string.Empty, _viewModel.SelectionSummary);
        Assert.IsFalse(_viewModel.IsEngineReady);
    }
}
