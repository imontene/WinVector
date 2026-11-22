using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Propiedades propias de la forma seleccionada en el panel (issue #59).</summary>
[TestClass]
public sealed class MainViewModelShapeTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelShapeTests()
    {
        _bridge = new BridgeClient(_transport);
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
    }

    private void Select(string tag, string shape) =>
        _transport.SendEvent(
            "selection.changed",
            $$"""{"documentId":"d1","items":[{"id":null,"tagName":"{{tag}}"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null,"shape":{{shape}}}""");

    private string Keys() => string.Join(" ", _viewModel.ShapeFields.Select(f => f.Key));

    private double Field(string key) => _viewModel.ShapeFields.Single(f => f.Key == key).Value;

    [TestMethod]
    public async Task CadaTipoDeFormaMuestraSusCampos()
    {
        await ReadyAsync();

        Select("rect", """{"type":"rect","x":1,"y":2,"width":30,"height":20,"cornerRadius":4}""");
        Assert.AreEqual("x y width height cornerRadius", Keys());
        Assert.AreEqual(4, Field("cornerRadius"));
        Assert.AreEqual("Rect", _viewModel.ShapeTitle);
        Assert.AreEqual("ShapeCornerRadius", _viewModel.ShapeFields[4].AutomationId);

        Select("polygon", """{"type":"star","cx":50,"cy":50,"r":20,"sides":5,"inner":0.38,"rotation":-90,"rounding":0}""");
        Assert.AreEqual("cx cy r sides inner rotation rounding", Keys());
        Assert.AreEqual(38, Field("inner"), "El radio interior se muestra en porcentaje.");

        Select("line", """{"type":"line","x1":0,"y1":0,"x2":30,"y2":40}""");
        Assert.AreEqual(50, Field("length"));
        Assert.AreEqual(53.13, Field("angle"));
    }

    [TestMethod]
    public async Task SinUnaSolaFormaNoHayCampos()
    {
        await ReadyAsync();
        Select("rect", """{"type":"rect","x":1,"y":2,"width":30,"height":20,"cornerRadius":0}""");
        Assert.IsTrue(_viewModel.HasShapeFields);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"a","tagName":"rect"},{"id":"b","tagName":"rect"}],"bounds":{"x":0,"y":0,"width":10,"height":10},"scope":null}""");
        Assert.IsFalse(_viewModel.HasShapeFields);
        Assert.AreEqual(string.Empty, _viewModel.ShapeTitle);
    }

    [TestMethod]
    public async Task CambiarUnCampoEnviaSoloEseValor()
    {
        await ReadyAsync();
        Select("polygon", """{"type":"star","cx":50,"cy":50,"r":20,"sides":5,"inner":0.5,"rotation":-90,"rounding":0}""");

        Assert.IsTrue(_viewModel.SetShapeField("sides", 7.4));
        Assert.IsTrue(_viewModel.SetShapeField("inner", 40));
        Assert.IsTrue(_viewModel.SetShapeField("rounding", 25));
        await _viewModel.EngineWork;

        Assert.AreEqual(
            """{"documentId":"d1","sides":7} | {"documentId":"d1","inner":0.4} | {"documentId":"d1","rounding":0.25}""",
            string.Join(" | ", _engine.ShapesSet));
    }

    [TestMethod]
    public async Task LaLongitudYElAnguloDeUnaLineaMuevenSuSegundoExtremo()
    {
        await ReadyAsync();
        Select("line", """{"type":"line","x1":10,"y1":10,"x2":40,"y2":50}""");

        Assert.IsTrue(_viewModel.SetShapeField("length", 100));
        Assert.IsTrue(_viewModel.SetShapeField("angle", 90));
        await _viewModel.EngineWork;

        Assert.AreEqual(
            """{"documentId":"d1","x2":70,"y2":90} | {"documentId":"d1","x2":10,"y2":60}""",
            string.Join(" | ", _engine.ShapesSet));
    }

    [TestMethod]
    [DataRow("width", 0)]
    [DataRow("r", -3)]
    [DataRow("sides", 2)]
    [DataRow("rounding", 120)]
    [DataRow("cx", double.NaN)]
    public async Task UnValorNoValidoNoCambiaNadaYSeVuelveAMostrarElActual(string key, double value)
    {
        await ReadyAsync();
        Select("rect", """{"type":"rect","x":1,"y":2,"width":30,"height":20,"cornerRadius":0}""");
        Select("polygon", """{"type":"polygon","cx":50,"cy":50,"r":20,"sides":6,"rotation":0,"rounding":0}""");
        if (key == "width")
        {
            Select("rect", """{"type":"rect","x":1,"y":2,"width":30,"height":20,"cornerRadius":0}""");
        }

        var field = _viewModel.ShapeFields.Single(f => f.Key == key);
        var refreshed = 0;
        field.PropertyChanged += (_, _) => refreshed++;

        Assert.IsFalse(_viewModel.SetShapeField(key, value));
        await _viewModel.EngineWork;

        Assert.IsEmpty(_engine.ShapesSet);
        Assert.AreEqual(1, refreshed, "El campo debe volver a mostrar el valor actual.");
    }

    [TestMethod]
    public async Task ElMismoValorNoEnviaNiRefresca()
    {
        await ReadyAsync();
        Select("circle", """{"type":"circle","cx":5,"cy":6,"r":7}""");
        Assert.IsFalse(_viewModel.SetShapeField("r", 7));
        await _viewModel.EngineWork;
        Assert.IsEmpty(_engine.ShapesSet);
    }

    [TestMethod]
    public async Task AlConvertirUnaFormaSeAvisaHastaCambiarDeHerramienta()
    {
        await ReadyAsync();
        _transport.SendEvent("shape.converted", """{"documentId":"d1","from":"star"}""");
        Assert.AreEqual("Star → polígono", _viewModel.CanvasNotice);

        _transport.SendEvent("tool.changed", """{"tool":"select"}""");
        _transport.SendEvent("tool.changed", """{"tool":"vertex"}""");
        Assert.AreEqual(string.Empty, _viewModel.CanvasNotice);

        _transport.SendEvent("shape.converted", """{"documentId":"otro","from":"rect"}""");
        Assert.AreEqual(string.Empty, _viewModel.CanvasNotice, "Un aviso de otro documento no se muestra.");
    }

    [TestMethod]
    public async Task UnTextoQueNoSePuedeEditarSeExplicaEnLaBarraDeEstado()
    {
        await ReadyAsync();
        _transport.SendEvent("text.locked", """{"documentId":"otro","reason":"text-path"}""");
        Assert.AreEqual(string.Empty, _viewModel.CanvasNotice, "Un aviso de otro documento no se muestra.");

        _transport.SendEvent("text.locked", """{"documentId":"d1","reason":"text-path"}""");
        Assert.AreEqual("Texto bloqueado: TextPath", _viewModel.CanvasNotice);
        Assert.IsTrue(_viewModel.Commands.All.Any(c => c.Id == "tool-text"));
    }

    [TestMethod]
    public async Task ElLienzoPideElMenuContextualYEditarVerticesEligeLaHerramienta()
    {
        await ReadyAsync();
        ContextMenuRequestedEventArgs? requested = null;
        _viewModel.ContextMenuRequested += (_, e) => requested = e;

        Select("polygon", """{"type":"polygon","cx":50,"cy":50,"r":20,"sides":6,"rotation":0,"rounding":0}""");
        Assert.IsTrue(_viewModel.EditVerticesCommand.CanExecute(null));
        _transport.SendEvent("canvas.contextMenu", """{"documentId":"d1","x":120.5,"y":80,"keyboard":false,"canEditVertices":true}""");

        Assert.IsNotNull(requested);
        Assert.AreEqual(120.5, requested.X);
        Assert.AreEqual(80, requested.Y);
        Assert.IsFalse(requested.Keyboard);

        await _viewModel.EditVerticesAsync();
        await _viewModel.EngineWork;
        Assert.AreEqual(ToolName.Vertex, _viewModel.ActiveTool);

        Select("path", "null");
        Assert.IsTrue(_viewModel.EditVerticesCommand.CanExecute(null), "Un trazado se edita por nodos.");

        Select("circle", """{"type":"circle","cx":5,"cy":6,"r":7}""");
        Assert.IsFalse(_viewModel.EditVerticesCommand.CanExecute(null), "Un círculo no se edita por vértices.");
    }

    [TestMethod]
    public async Task UnMenuDeOtroDocumentoNoSeAbre()
    {
        await ReadyAsync();
        var opened = false;
        _viewModel.ContextMenuRequested += (_, _) => opened = true;
        _transport.SendEvent("canvas.contextMenu", """{"documentId":"otro","x":1,"y":2,"keyboard":true,"canEditVertices":false}""");
        Assert.IsFalse(opened);
    }
}
