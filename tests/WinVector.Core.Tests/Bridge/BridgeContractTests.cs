using System.Text.Json;
using WinVector.Core.Bridge;

namespace WinVector.Core.Tests.Bridge;

/// <summary>
/// Comprueba que el C# generado a partir de contracts/ lee y escribe los mensajes tal como los
/// produce el motor.
/// </summary>
[TestClass]
public sealed class BridgeContractTests
{
    private static readonly BridgeJsonContext Context = BridgeJsonContext.Default;

    [TestMethod]
    public void LeeUnEventoTalComoLoEnviaElMotor()
    {
        const string json = """
            {"kind":"event","id":"e1","name":"selection.changed","protocolVersion":1,
             "payload":{"items":[{"id":"sol","tagName":"circle"},{"id":null,"tagName":"path"}]}}
            """;

        var envelope = JsonSerializer.Deserialize(json, Context.BridgeEnvelope);

        Assert.IsNotNull(envelope);
        Assert.AreEqual(BridgeMessageKind.Event, envelope.Kind);
        Assert.AreEqual(BridgeEvents.SelectionChanged.Name, envelope.Name);
        Assert.IsNotNull(envelope.Payload);
        var payload = envelope.Payload.Value.Deserialize(Context.SelectionChanged);
        Assert.IsNotNull(payload);
        Assert.HasCount(2, payload.Items);
        Assert.AreEqual(new SelectedElement("sol", "circle"), payload.Items[0]);
        Assert.IsNull(payload.Items[1].Id);
    }

    [TestMethod]
    public void EscribeUnComandoSinCamposVacios()
    {
        var payload = JsonSerializer.SerializeToElement(new AppPing(1234.5), Context.AppPing);
        var envelope = new BridgeEnvelope(BridgeMessageKind.Command, "c1", BridgeCommands.AppPing.Name, BridgeProtocol.Version, payload);

        var json = JsonSerializer.Serialize(envelope, Context.BridgeEnvelope);

        Assert.AreEqual("""{"kind":"command","id":"c1","name":"app.ping","protocolVersion":1,"payload":{"sentAt":1234.5}}""", json);
    }

    [TestMethod]
    public void LeeUnaRespuestaFallida()
    {
        const string json = """
            {"kind":"response","id":"c1","name":"app.ping","protocolVersion":1,"ok":false,
             "error":{"code":"unknown-message","message":"desconocido","relatedId":"c1"}}
            """;

        var envelope = JsonSerializer.Deserialize(json, Context.BridgeEnvelope);

        Assert.IsNotNull(envelope);
        Assert.IsFalse(envelope.Ok);
        Assert.IsNull(envelope.Payload);
        Assert.AreEqual(new BridgeError(BridgeErrorCode.UnknownMessage, "desconocido", "c1"), envelope.Error);
    }

    [TestMethod]
    public void LosEnumUsanLosValoresDelEsquema()
    {
        var json = JsonSerializer.Serialize(new BridgeError(BridgeErrorCode.ProtocolMismatch, "x", null), Context.BridgeError);

        Assert.AreEqual("""{"code":"protocol-mismatch","message":"x","relatedId":null}""", json);
    }

    [TestMethod]
    [DataRow("""{"engineVersion":"0.1.0"}""", DisplayName = "Falta un campo obligatorio")]
    [DataRow("""{"engineVersion":null,"protocolVersion":1}""", DisplayName = "null en un campo que no lo admite")]
    public void RechazaPayloadsIncompletos(string json)
    {
        Assert.ThrowsExactly<JsonException>(() => JsonSerializer.Deserialize(json, Context.EngineReady));
    }

    [TestMethod]
    public void RechazaUnValorDeEnumDesconocido()
    {
        Assert.ThrowsExactly<JsonException>(
            () => JsonSerializer.Deserialize("""{"code":"otro","message":"x","relatedId":null}""", Context.BridgeError));
    }
}
