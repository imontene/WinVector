using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

/// <summary>Órdenes de los nodos de un trazado en el menú Trazado y el panel (issue #77).</summary>
[TestClass]
public sealed class MainViewModelNodesTests : IDisposable
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly BridgeClient _bridge;
    private readonly IDisposable _attachment;
    private readonly MainViewModel _viewModel = new(TestTexts.Instance, new FakeDialogs());
    private readonly FakeEngine _engine;

    public MainViewModelNodesTests()
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

    private void Nodes(string json) => _transport.SendEvent("nodes.changed", json);

    [TestMethod]
    public async Task SinNodosSeleccionadosLasOrdenesEstanDeshabilitadas()
    {
        await ReadyAsync();
        Assert.IsFalse(_viewModel.HasSelectedNodes);
        Assert.AreEqual(string.Empty, _viewModel.SelectedNodesText);
        Assert.IsFalse(_viewModel.MakeNodesCornerCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeNodesSmoothCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeNodesSymmetricCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeSegmentsLineCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeSegmentsCurveCommand.CanExecute(null));
    }

    [TestMethod]
    public async Task LosNodosSeleccionadosHabilitanLoQueSePuedeHacer()
    {
        await ReadyAsync();
        Nodes("""{"documentId":"d1","count":2,"kind":"smooth","canSmooth":true,"canMakeLine":true,"canMakeCurve":false}""");

        Assert.IsTrue(_viewModel.HasSelectedNodes);
        Assert.AreEqual("2 nodos · Smooth", _viewModel.SelectedNodesText);
        Assert.IsTrue(_viewModel.MakeNodesCornerCommand.CanExecute(null));
        Assert.IsTrue(_viewModel.MakeNodesSmoothCommand.CanExecute(null));
        Assert.IsTrue(_viewModel.MakeNodesSymmetricCommand.CanExecute(null));
        Assert.IsTrue(_viewModel.MakeSegmentsLineCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeSegmentsCurveCommand.CanExecute(null));

        // Un extremo de un trazado abierto: solo puede ser esquina.
        Nodes("""{"documentId":"d1","count":1,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false}""");
        Assert.AreEqual("1 nodos", _viewModel.SelectedNodesText);
        Assert.IsTrue(_viewModel.MakeNodesCornerCommand.CanExecute(null));
        Assert.IsFalse(_viewModel.MakeNodesSmoothCommand.CanExecute(null));

        Nodes("""{"documentId":"d1","count":0,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false}""");
        Assert.IsFalse(_viewModel.HasSelectedNodes);
        Assert.IsFalse(_viewModel.MakeNodesCornerCommand.CanExecute(null));
    }

    [TestMethod]
    public async Task CadaOrdenEnviaSuAccionAlMotor()
    {
        await ReadyAsync();
        Nodes("""{"documentId":"d1","count":2,"kind":"mixed","canSmooth":true,"canMakeLine":true,"canMakeCurve":true}""");

        await _viewModel.MakeNodesCornerAsync();
        await _viewModel.MakeNodesSmoothAsync();
        await _viewModel.MakeNodesSymmetricAsync();
        await _viewModel.MakeSegmentsLineAsync();
        await _viewModel.MakeSegmentsCurveAsync();
        await _viewModel.EngineWork;

        Assert.AreEqual("corner smooth symmetric line curve", string.Join(" ", _engine.NodeActions));
        Assert.IsTrue(_engine.Commands.Contains("path.nodes d1"));
    }

    [TestMethod]
    public async Task LosNodosDeOtroDocumentoNoSeMuestranYCambiarDePestanaLosOlvida()
    {
        await ReadyAsync();
        Nodes("""{"documentId":"otro","count":3,"canSmooth":true,"canMakeLine":true,"canMakeCurve":true}""");
        Assert.IsFalse(_viewModel.HasSelectedNodes);

        Nodes("""{"documentId":"d1","count":3,"canSmooth":true,"canMakeLine":true,"canMakeCurve":true}""");
        Assert.IsTrue(_viewModel.HasSelectedNodes);
        _viewModel.NewDocument();
        await _viewModel.EngineWork;
        Assert.IsFalse(_viewModel.HasSelectedNodes);
        Assert.IsFalse(_viewModel.MakeSegmentsCurveCommand.CanExecute(null));
    }

    [TestMethod]
    public async Task ElRadioDeLasEsquinasSeMuestraYSeCambia()
    {
        await ReadyAsync();
        Nodes("""{"documentId":"d1","count":2,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false,"canRound":true,"cornerRadius":12.346}""");
        Assert.IsTrue(_viewModel.CanRoundCorners);
        Assert.AreEqual(12.35, _viewModel.SelectedCornerRadius);
        Assert.IsFalse(_viewModel.SetCornerRadius(12.35), "El mismo radio no se envía.");
        Assert.IsFalse(_viewModel.SetCornerRadius(-1));

        Assert.IsTrue(_viewModel.SetCornerRadius(4));
        Assert.IsTrue(_viewModel.SetCornerRadius(0));
        await _viewModel.EngineWork;
        Assert.AreEqual("radius 4 radius 0", string.Join(" ", _engine.NodeActions));

        // Radios distintos: el panel no muestra ninguno. Sin esquinas, no se puede redondear.
        Nodes("""{"documentId":"d1","count":2,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false,"canRound":true}""");
        Assert.IsTrue(double.IsNaN(_viewModel.SelectedCornerRadius));
        Nodes("""{"documentId":"d1","count":1,"canSmooth":false,"canMakeLine":false,"canMakeCurve":false}""");
        Assert.IsFalse(_viewModel.CanRoundCorners);
        Assert.IsFalse(_viewModel.SetCornerRadius(5));
    }

    [TestMethod]
    public void LasOrdenesEstanEnLaPaletaDeComandos()
    {
        foreach (var id in new[] { "nodes-corner", "nodes-smooth", "nodes-symmetric", "segments-line", "segments-curve" })
        {
            Assert.IsTrue(_viewModel.Commands.All.Any(c => c.Id == id), id);
        }
    }
}
