using Microsoft.Extensions.Time.Testing;
using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using WinVector.Core.Tests.Bridge;

namespace WinVector.Core.Tests.Shell;

[TestClass]
public sealed class MainViewModelBridgeTests
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly FakeTimeProvider _time = new();

    private (MainViewModel ViewModel, BridgeClient Bridge, IDisposable Attachment) Create()
    {
        var viewModel = new MainViewModel(MainViewModelTests.Texts, timeProvider: _time);
        var bridge = new BridgeClient(_transport, timeProvider: _time);
        return (viewModel, bridge, viewModel.AttachBridge(bridge));
    }

    [TestMethod]
    public async Task AlCargarElMotorMideLaLatencia()
    {
        var (viewModel, bridge, attachment) = Create();
        using (bridge)
        using (attachment)
        {
            _transport.SendEvent("engine.ready", """{"engineVersion":"0.0.0","protocolVersion":1}""");

            Assert.IsTrue(viewModel.IsEngineReady);
            Assert.AreEqual(string.Empty, viewModel.EngineStatus);
            var ping = _transport.LastPosted();
            Assert.AreEqual("app.ping", ping.GetProperty("name").GetString());

            _time.Advance(TimeSpan.FromMilliseconds(4));
            _transport.RespondOk("c1", "app.ping", """{"sentAt":0,"receivedAt":0}""");
            await viewModel.LatencyMeasurement;

            Assert.AreEqual(TimeSpan.FromMilliseconds(4), viewModel.BridgeLatency);
        }
    }

    [TestMethod]
    public async Task SiElPingFallaLaLatenciaQuedaVacia()
    {
        var (viewModel, bridge, attachment) = Create();
        using (bridge)
        using (attachment)
        {
            _transport.SendEvent("engine.ready", """{"engineVersion":"0.0.0","protocolVersion":1}""");
            _time.Advance(BridgeClient.DefaultTimeout);
            await viewModel.LatencyMeasurement;

            Assert.IsNull(viewModel.BridgeLatency);
            Assert.IsTrue(viewModel.IsEngineReady);
        }
    }

    [TestMethod]
    public void UnMotorConOtroProtocoloSeMarcaComoIncompatible()
    {
        var (viewModel, bridge, attachment) = Create();
        using (bridge)
        using (attachment)
        {
            _transport.SendEvent("engine.ready", """{"engineVersion":"9.0.0","protocolVersion":2}""", protocolVersion: 2);

            Assert.IsFalse(viewModel.IsEngineReady);
            Assert.AreEqual("Protocolo 2, se esperaba 1", viewModel.EngineStatus);
            Assert.IsEmpty(_transport.Posted);
        }
    }

    [TestMethod]
    [DataRow("""{"items":[{"id":"sol","tagName":"circle"}]}""", "circle#sol")]
    [DataRow("""{"items":[{"id":null,"tagName":"path"}]}""", "path")]
    [DataRow("""{"items":[{"id":"a","tagName":"rect"},{"id":"b","tagName":"rect"}]}""", "2 objetos")]
    [DataRow("""{"items":[]}""", "")]
    public void ResumeLaSeleccion(string payload, string expected)
    {
        var (viewModel, bridge, attachment) = Create();
        using (bridge)
        using (attachment)
        {
            _transport.SendEvent("selection.changed", """{"items":[{"id":"previo","tagName":"g"}]}""");
            _transport.SendEvent("selection.changed", payload);

            Assert.AreEqual(expected, viewModel.SelectionSummary);
        }
    }

    [TestMethod]
    public void AlDesconectarseDejaDeActualizarse()
    {
        var (viewModel, bridge, attachment) = Create();
        using (bridge)
        {
            attachment.Dispose();
            _transport.SendEvent("selection.changed", """{"items":[{"id":"sol","tagName":"circle"}]}""");

            Assert.AreEqual(string.Empty, viewModel.SelectionSummary);
        }
    }
}
