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

        Assert.AreEqual("document.load d1 | document.activate d1 | app.ping", string.Join(" | ", _engine.Commands));
        Assert.IsTrue(_viewModel.Documents[0].IsLoaded);
        Assert.AreEqual("d1", _engine.ActiveDocument);
        Assert.IsTrue(_viewModel.IsEngineReady);
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
        _transport.SendEvent("selection.changed", """{"documentId":"d2","items":[{"id":"sol","tagName":"circle"}]}""");

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
    [DataRow("""{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}]}""", "circle#sol")]
    [DataRow("""{"documentId":"d1","items":[{"id":null,"tagName":"path"}]}""", "path")]
    [DataRow("""{"documentId":"d1","items":[{"id":"a","tagName":"rect"},{"id":"b","tagName":"rect"}]}""", "2 objetos")]
    [DataRow("""{"documentId":"d1","items":[]}""", "")]
    [DataRow("""{"documentId":"otro","items":[{"id":"x","tagName":"rect"}]}""", "previo")]
    public void ResumeLaSeleccionDelDocumentoActivo(string payload, string expected)
    {
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"previo","tagName":"g"}]}""");
        _transport.SendEvent("selection.changed", payload);

        Assert.AreEqual(expected == "previo" ? "g#previo" : expected, _viewModel.SelectionSummary);
    }

    [TestMethod]
    public void AlDesconectarseDejaDeActualizarse()
    {
        _attachment.Dispose();
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}]}""");

        Assert.AreEqual(string.Empty, _viewModel.SelectionSummary);
        Assert.IsFalse(_viewModel.IsEngineReady);
    }
}
