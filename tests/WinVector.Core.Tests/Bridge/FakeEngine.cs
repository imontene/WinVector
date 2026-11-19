using System.Text.Json;
using WinVector.Core.Bridge;

namespace WinVector.Core.Tests.Bridge;

/// <summary>
/// Motor simulado: responde a los comandos del documento como el motor real y guarda lo que recibe.
/// </summary>
internal sealed class FakeEngine
{
    private readonly FakeBridgeTransport _transport;
    private readonly Dictionary<string, string> _documents = [];
    private readonly Dictionary<string, int> _revisions = [];
    private readonly Dictionary<string, Stack<Snapshot>> _undo = [];
    private readonly Dictionary<string, Stack<Snapshot>> _redo = [];
    private int _lastRevision;

    public FakeEngine(FakeBridgeTransport transport)
    {
        _transport = transport;
        _transport.Posted.Clear();
        _transport.OnPosted = Respond;
    }

    /// <summary>Comandos recibidos, como "document.load d1".</summary>
    public List<string> Commands { get; } = [];

    /// <summary>Payloads de selection.setGeometry recibidos, tal cual.</summary>
    public List<string> GeometriesSet { get; } = [];

    /// <summary>Payloads de artboard.set recibidos, tal cual.</summary>
    public List<string> ArtboardsSet { get; } = [];

    /// <summary>Documentos que el motor rechazará como no válidos.</summary>
    public HashSet<string> InvalidSvgs { get; } = [];

    public string? ActiveDocument { get; private set; }

    /// <summary>Se ejecuta justo antes de responder a app.ping, por ejemplo para avanzar el reloj.</summary>
    public Action? BeforePingResponse { get; set; }

    /// <summary>
    /// Simula una edición: cambia el texto del documento, lo anota en el historial y avisa con
    /// document.changed y history.changed, como el motor real.
    /// </summary>
    public void Modify(string documentId, string svg, string action = "edit")
    {
        UndoStack(documentId).Push(new Snapshot(_documents[documentId], _revisions.GetValueOrDefault(documentId), action));
        RedoStack(documentId).Clear();
        _documents[documentId] = svg;
        _revisions[documentId] = ++_lastRevision;
        SendChanged(documentId);
        _transport.SendEvent("history.changed", HistoryJson(documentId));
    }

    /// <summary>Texto que el motor tiene de un documento.</summary>
    public string DocumentText(string documentId) => _documents[documentId];

    private Stack<Snapshot> UndoStack(string documentId) => Stack(_undo, documentId);

    private Stack<Snapshot> RedoStack(string documentId) => Stack(_redo, documentId);

    private static Stack<Snapshot> Stack(Dictionary<string, Stack<Snapshot>> stacks, string documentId)
    {
        if (!stacks.TryGetValue(documentId, out var stack))
        {
            stack = new Stack<Snapshot>();
            stacks[documentId] = stack;
        }

        return stack;
    }

    /// <summary>Deshace o rehace: pasa un paso de una pila a la otra y restaura su texto y su revisión.</summary>
    private void Step(string documentId, Stack<Snapshot> from, Stack<Snapshot> to)
    {
        if (!from.TryPop(out var step))
        {
            return;
        }

        to.Push(new Snapshot(_documents[documentId], _revisions.GetValueOrDefault(documentId), step.Action));
        _documents[documentId] = step.Svg;
        _revisions[documentId] = step.Revision;
        SendChanged(documentId);
        _transport.SendEvent("history.changed", HistoryJson(documentId));
    }

    private void SendChanged(string documentId) =>
        _transport.SendEvent("document.changed", $$"""{"documentId":"{{documentId}}","revision":{{_revisions[documentId]}}}""");

    private string HistoryJson(string documentId)
    {
        var undo = UndoStack(documentId);
        var redo = RedoStack(documentId);
        return JsonSerializer.Serialize(new
        {
            documentId,
            canUndo = undo.Count > 0,
            canRedo = redo.Count > 0,
            undoAction = undo.Count > 0 ? undo.Peek().Action : null,
            redoAction = redo.Count > 0 ? redo.Peek().Action : null,
        });
    }

    public void Ready() =>
        _transport.SendEvent("engine.ready", $$"""{"engineVersion":"0.0.0","protocolVersion":{{BridgeProtocol.Version}}}""");

    private void Respond(string json)
    {
        var message = JsonDocument.Parse(json).RootElement;
        var id = message.GetProperty("id").GetString()!;
        var name = message.GetProperty("name").GetString()!;
        var payload = message.GetProperty("payload");
        var documentId = payload.TryGetProperty("documentId", out var value) ? value.GetString() : null;
        Commands.Add(documentId is null ? name : $"{name} {documentId}");

        switch (name)
        {
            case "document.load":
                var svg = payload.GetProperty("svg").GetString()!;
                if (InvalidSvgs.Contains(svg))
                {
                    _transport.RespondOk(id, name, $$$"""{"documentId":"{{{documentId}}}","loaded":false,"revision":0,"exactMapping":false,"error":{"message":"XML no válido","line":1,"column":2}}""");
                }
                else
                {
                    _documents[documentId!] = svg;
                    _revisions[documentId!] = 0;
                    _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","loaded":true,"revision":0,"exactMapping":true,"error":null}""");
                }

                break;
            case "document.activate":
                ActiveDocument = documentId;
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","revision":0}""");
                break;
            case "document.close":
                _documents.Remove(documentId!);
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}"}""");
                break;
            case "document.serialize":
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","svg":{{JsonSerializer.Serialize(_documents[documentId!])}},"revision":{{_revisions.GetValueOrDefault(documentId!)}}}""");
                break;
            case "view.setOptions":
            case "tool.select":
                _transport.RespondOk(id, name, payload.GetRawText());
                break;
            case "view.zoom":
                var zoom = payload.GetProperty("action").GetString() switch
                {
                    "in" => 1.5,
                    "out" => 0.6667,
                    "actual" => 1.0,
                    _ => 0.8,
                };
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","zoom":{{zoom.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}""");
                break;
            case "artboard.set":
                ArtboardsSet.Add(payload.GetRawText());
                _transport.RespondOk(id, name, payload.GetRawText());
                break;
            case "selection.setGeometry":
                GeometriesSet.Add(payload.GetRawText());
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}"}""");
                break;
            case "selection.selectAll":
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}"}""");
                break;
            case "history.undo":
                Step(documentId!, UndoStack(documentId!), RedoStack(documentId!));
                _transport.RespondOk(id, name, HistoryJson(documentId!));
                break;
            case "history.redo":
                Step(documentId!, RedoStack(documentId!), UndoStack(documentId!));
                _transport.RespondOk(id, name, HistoryJson(documentId!));
                break;
            case "app.ping":
                BeforePingResponse?.Invoke();
                _transport.RespondOk(id, name, """{"sentAt":0,"receivedAt":0}""");
                break;
        }
    }

    private sealed record Snapshot(string Svg, int Revision, string Action);
}
