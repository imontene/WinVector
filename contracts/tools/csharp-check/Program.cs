using System.Text.Json;
using WinVector.Core.Bridge;

var context = BridgeJsonContext.Default;
var failures = new List<string>();

void Check(string name, Action test)
{
    try
    {
        test();
        Console.WriteLine($"ok    {name}");
    }
    catch (Exception ex)
    {
        failures.Add(name);
        Console.WriteLine($"FALLO {name}: {ex.Message}");
    }
}

void Expect(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

void ExpectJsonException(Action action)
{
    try
    {
        action();
    }
    catch (JsonException)
    {
        return;
    }

    throw new InvalidOperationException("Se esperaba JsonException");
}

Check("lee un evento tal como lo envía el motor", () =>
{
    const string json = """
        {"kind":"event","id":"e1","name":"selection.changed","protocolVersion":1,
         "payload":{"items":[{"id":"sol","tagName":"circle"},{"id":null,"tagName":"path"}]}}
        """;
    var envelope = JsonSerializer.Deserialize(json, context.BridgeEnvelope)!;
    Expect(envelope.Kind == BridgeMessageKind.Event, "kind");
    Expect(envelope.Name == BridgeEvents.SelectionChanged.Name, "name");
    var payload = envelope.Payload!.Value.Deserialize(context.SelectionChanged)!;
    Expect(payload.Items.Count == 2, "items");
    Expect(payload.Items[0] == new SelectedElement("sol", "circle"), "primer elemento");
    Expect(payload.Items[1].Id is null, "id null");
});

Check("escribe un comando sin campos vacíos", () =>
{
    var payload = JsonSerializer.SerializeToElement(new AppPing(1234.5), context.AppPing);
    var envelope = new BridgeEnvelope(BridgeMessageKind.Command, "c1", BridgeCommands.AppPing.Name, BridgeProtocol.Version, payload);
    var json = JsonSerializer.Serialize(envelope, context.BridgeEnvelope);
    Expect(json == """{"kind":"command","id":"c1","name":"app.ping","protocolVersion":1,"payload":{"sentAt":1234.5}}""", json);
});

Check("lee una respuesta fallida", () =>
{
    const string json = """
        {"kind":"response","id":"c1","name":"app.ping","protocolVersion":1,"ok":false,
         "error":{"code":"unknown-message","message":"desconocido","relatedId":"c1"}}
        """;
    var envelope = JsonSerializer.Deserialize(json, context.BridgeEnvelope)!;
    Expect(envelope.Ok == false, "ok");
    Expect(envelope.Payload is null, "sin payload");
    Expect(envelope.Error == new BridgeError(BridgeErrorCode.UnknownMessage, "desconocido", "c1"), "error");
});

Check("los enum usan los valores del esquema", () =>
{
    var json = JsonSerializer.Serialize(new BridgeError(BridgeErrorCode.ProtocolMismatch, "x", null), context.BridgeError);
    Expect(json == """{"code":"protocol-mismatch","message":"x","relatedId":null}""", json);
});

Check("rechaza un payload al que le falta un campo obligatorio", () =>
    ExpectJsonException(() => JsonSerializer.Deserialize("""{"engineVersion":"0.1.0"}""", context.EngineReady)));

Check("rechaza null en un campo que no admite null", () =>
    ExpectJsonException(() => JsonSerializer.Deserialize("""{"engineVersion":null,"protocolVersion":1}""", context.EngineReady)));

Check("rechaza un valor de enum desconocido", () =>
    ExpectJsonException(() => JsonSerializer.Deserialize("""{"code":"otro","message":"x","relatedId":null}""", context.BridgeError)));

Console.WriteLine(failures.Count == 0 ? "Todas las comprobaciones pasan." : $"{failures.Count} comprobaciones fallan.");
return failures.Count == 0 ? 0 : 1;
