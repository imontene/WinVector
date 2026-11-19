using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;
using WinVector.Core.Bridge;

namespace WinVector.Core.Tests.Bridge;

[TestClass]
public sealed class BridgeClientTests
{
    private readonly FakeBridgeTransport _transport = new();
    private readonly FakeTimeProvider _time = new();
    private readonly ListLogger<BridgeClient> _logger = new();

    private BridgeClient Create() => new(_transport, _logger, _time);

    [TestMethod]
    public async Task EnviaElComandoYDevuelveLaRespuesta()
    {
        using var client = Create();

        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1000));
        var sent = _transport.LastPosted();
        Assert.AreEqual("command", sent.GetProperty("kind").GetString());
        Assert.AreEqual("c1", sent.GetProperty("id").GetString());
        Assert.AreEqual("app.ping", sent.GetProperty("name").GetString());
        Assert.AreEqual(1000, sent.GetProperty("payload").GetProperty("sentAt").GetDouble());

        _transport.RespondOk("c1", "app.ping", """{"sentAt":1000,"receivedAt":1003}""");

        Assert.AreEqual(new AppPong(1000, 1003), await task);
    }

    [TestMethod]
    public async Task CadaComandoTieneSuPropioId()
    {
        using var client = Create();

        var first = client.SendAsync(BridgeCommands.AppPing, new AppPing(1));
        var second = client.SendAsync(BridgeCommands.AppPing, new AppPing(2));
        _transport.RespondOk("c2", "app.ping", """{"sentAt":2,"receivedAt":20}""");
        _transport.RespondOk("c1", "app.ping", """{"sentAt":1,"receivedAt":10}""");

        Assert.AreEqual(10, (await first).ReceivedAt);
        Assert.AreEqual(20, (await second).ReceivedAt);
    }

    [TestMethod]
    public async Task UnaRespuestaFallidaLanzaBridgeException()
    {
        using var client = Create();

        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1));
        _transport.Receive("""
            {"kind":"response","id":"c1","name":"app.ping","protocolVersion":2,"ok":false,
             "error":{"code":"unknown-message","message":"Comando desconocido","relatedId":"c1"}}
            """);

        var error = await Assert.ThrowsExactlyAsync<BridgeException>(() => task);
        Assert.AreEqual(BridgeErrorCode.UnknownMessage, error.Code);
        Assert.AreEqual("Comando desconocido", error.Message);
    }

    [TestMethod]
    public async Task SinRespuestaAgotaElTiempo()
    {
        using var client = Create();

        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1));
        _time.Advance(BridgeClient.DefaultTimeout);

        var error = await Assert.ThrowsExactlyAsync<BridgeException>(() => task);
        Assert.AreEqual(BridgeErrorCode.Timeout, error.Code);
    }

    [TestMethod]
    public async Task UnaRespuestaTardiaSeIgnora()
    {
        using var client = Create();
        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1));
        _time.Advance(BridgeClient.DefaultTimeout);
        await Assert.ThrowsExactlyAsync<BridgeException>(() => task);

        _transport.RespondOk("c1", "app.ping", """{"sentAt":1,"receivedAt":2}""");
    }

    [TestMethod]
    public async Task SePuedeCancelarLaEspera()
    {
        using var client = Create();
        using var cancellation = new CancellationTokenSource();

        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1), cancellation.Token);
        await cancellation.CancelAsync();

        await Assert.ThrowsAsync<OperationCanceledException>(() => task);
    }

    [TestMethod]
    public void ReparteLosEventosConSuTipo()
    {
        using var client = Create();
        SelectionChanged? received = null;
        using var subscription = client.Subscribe(BridgeEvents.SelectionChanged, e => received = e);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[{"id":"sol","tagName":"circle"}]}""");

        Assert.IsNotNull(received);
        Assert.AreEqual(new SelectedElement("sol", "circle"), received.Items.Single());
    }

    [TestMethod]
    public void DejaDeRecibirEventosAlDescartarLaSuscripcion()
    {
        using var client = Create();
        var count = 0;
        var subscription = client.Subscribe(BridgeEvents.SelectionChanged, _ => count++);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[]}""");
        subscription.Dispose();
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[]}""");

        Assert.AreEqual(1, count);
    }

    [TestMethod]
    public void IgnoraMensajesDeOtrosOrigenes()
    {
        using var client = Create();
        var count = 0;
        using var subscription = client.Subscribe(BridgeEvents.SelectionChanged, _ => count++);

        _transport.Receive(
            """{"kind":"event","id":"e1","name":"selection.changed","protocolVersion":1,"payload":{"documentId":"d1","items":[]}}""",
            source: "https://example.com/");

        Assert.AreEqual(0, count);
        Assert.IsTrue(_logger.Entries.Any(e => e.Level == LogLevel.Warning && e.Message.Contains("example.com", StringComparison.Ordinal)));
    }

    [TestMethod]
    [DataRow("no es json")]
    [DataRow("""{"kind":"event"}""")]
    [DataRow("""{"kind":"otro","id":"e1","name":"x","protocolVersion":1}""")]
    [DataRow("null")]
    public void DescartaMensajesIlegiblesSinRomperse(string json)
    {
        using var client = Create();
        var count = 0;
        using var subscription = client.Subscribe(BridgeEvents.SelectionChanged, _ => count++);

        _transport.Receive(json);
        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[]}""");

        Assert.AreEqual(1, count);
        Assert.IsTrue(_logger.Entries.Any(e => e.Level == LogLevel.Warning));
    }

    [TestMethod]
    public void RegistraLosEventosErrorDelMotor()
    {
        using var client = Create();

        _transport.SendEvent("error", """{"code":"invalid-message","message":"Falta el id del comando.","relatedId":null}""");

        Assert.IsTrue(_logger.Entries.Any(e => e.Level == LogLevel.Warning && e.Message.Contains("Falta el id del comando.", StringComparison.Ordinal)));
    }

    [TestMethod]
    public void UnManejadorQueFallaNoAfectaALosDemas()
    {
        using var client = Create();
        var called = false;
        using var failing = client.Subscribe(BridgeEvents.SelectionChanged, _ => throw new InvalidOperationException("fallo"));
        using var working = client.Subscribe(BridgeEvents.SelectionChanged, _ => called = true);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[]}""");

        Assert.IsTrue(called);
        Assert.IsTrue(_logger.Entries.Any(e => e.Level == LogLevel.Error));
    }

    [TestMethod]
    public void UnPayloadIncompletoSeRegistraYNoLlegaAlManejador()
    {
        using var client = Create();
        var count = 0;
        using var subscription = client.Subscribe(BridgeEvents.SelectionChanged, _ => count++);

        _transport.SendEvent("selection.changed", """{"elementos":[]}""");

        Assert.AreEqual(0, count);
        Assert.IsTrue(_logger.Entries.Any(e => e.Message.Contains("selection.changed", StringComparison.Ordinal)));
    }

    [TestMethod]
    public void IgnoraEventosDeOtraVersionDelProtocolo()
    {
        using var client = Create();
        var count = 0;
        using var subscription = client.Subscribe(BridgeEvents.SelectionChanged, _ => count++);

        _transport.SendEvent("selection.changed", """{"documentId":"d1","items":[]}""", protocolVersion: 99);

        Assert.AreEqual(0, count);
    }

    [TestMethod]
    public async Task AlDescartarseCancelaLosComandosPendientes()
    {
        var client = Create();
        var task = client.SendAsync(BridgeCommands.AppPing, new AppPing(1));

        client.Dispose();

        await Assert.ThrowsAsync<OperationCanceledException>(() => task);
    }
}
