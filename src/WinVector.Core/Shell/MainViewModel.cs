using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Estado de la ventana principal: pestañas de documento, pestaña activa y estado del lienzo.
/// </summary>
/// <remarks>
/// Un único motor gestiona los documentos de todas las pestañas (ADR 0004). Las órdenes al motor
/// (cargar, activar, cerrar) se encolan para que lleguen en el orden en que se producen.
/// </remarks>
public sealed partial class MainViewModel : ObservableObject
{
    /// <summary>
    /// Tiempo máximo de los comandos que llevan un documento completo. Medido con el puente real:
    /// cargar 20 MB tarda unos 7 s y 50 MB unos 17 s (ver contracts/README.md).
    /// </summary>
    public static readonly TimeSpan DocumentCommandTimeout = TimeSpan.FromMinutes(2);

    private readonly ShellTexts _texts;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private BridgeClient? _bridge;
    private Task _engineWork = Task.CompletedTask;
    private int _untitledCount;
    private int _documentCount;

    public MainViewModel(ShellTexts texts, ILogger<MainViewModel>? logger = null, TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(texts);
        _texts = texts;
        _logger = logger ?? NullLogger<MainViewModel>.Instance;
        _time = timeProvider ?? TimeProvider.System;
        NewDocument();
    }

    /// <summary>Pestañas abiertas, en el orden en que se muestran.</summary>
    public ObservableCollection<DocumentTabViewModel> Documents { get; } = [];

    /// <summary>Pestaña activa. Nunca es null mientras haya pestañas abiertas.</summary>
    [ObservableProperty]
    private DocumentTabViewModel? _selectedDocument;

    /// <summary>Resumen de la selección del lienzo para la barra de estado ("circle#sol"). Vacío sin selección.</summary>
    [ObservableProperty]
    private string _selectionSummary = string.Empty;

    /// <summary>Aviso sobre el estado del motor para la barra de estado. Vacío si todo va bien.</summary>
    [ObservableProperty]
    private string _engineStatus = string.Empty;

    /// <summary>True cuando el motor ha cargado y usa la misma versión del protocolo.</summary>
    [ObservableProperty]
    private bool _isEngineReady;

    /// <summary>Latencia de ida y vuelta del puente medida con app.ping al cargar el motor.</summary>
    [ObservableProperty]
    private TimeSpan? _bridgeLatency;

    /// <summary>Última medición de latencia en curso o terminada. Permite esperarla en las pruebas.</summary>
    internal Task LatencyMeasurement { get; private set; } = Task.CompletedTask;

    /// <summary>Órdenes al motor pendientes. Permite esperarlas en las pruebas.</summary>
    internal Task EngineWork => _engineWork;

    /// <summary>Abre un documento nuevo vacío y lo activa.</summary>
    [RelayCommand]
    public void NewDocument()
    {
        _untitledCount++;
        OpenDocument(_texts.UntitledDocument(_untitledCount), DocumentTemplates.Blank());
    }

    /// <summary>Abre un documento a partir de su texto SVG en una pestaña nueva y la activa.</summary>
    public DocumentTabViewModel OpenDocument(string title, string svg)
    {
        _documentCount++;
        var document = new DocumentTabViewModel(
            string.Create(CultureInfo.InvariantCulture, $"d{_documentCount}"),
            title,
            svg);
        Documents.Add(document);
        if (IsEngineReady)
        {
            Enqueue(() => LoadAsync(document));
        }

        SelectedDocument = document;
        return document;
    }

    /// <summary>
    /// Cierra una pestaña. Si era la activa, se activa la vecina; si era la última, se abre un
    /// documento nuevo para que la ventana nunca quede vacía.
    /// </summary>
    [RelayCommand]
    public void CloseDocument(DocumentTabViewModel? document)
    {
        if (document is null)
        {
            return;
        }

        var index = Documents.IndexOf(document);
        if (index < 0)
        {
            return;
        }

        var wasSelected = ReferenceEquals(document, SelectedDocument);
        Documents.RemoveAt(index);
        if (IsEngineReady && document.IsLoaded)
        {
            Enqueue(() => SendAsync(BridgeCommands.DocumentClose, new DocumentRef(document.DocumentId)));
        }

        if (Documents.Count == 0)
        {
            NewDocument();
        }
        else if (wasSelected)
        {
            SelectedDocument = Documents[Math.Min(index, Documents.Count - 1)];
        }
    }

    /// <summary>Pide al motor el texto actual de un documento, por ejemplo para guardarlo.</summary>
    /// <exception cref="BridgeException">El motor no está disponible o no conoce el documento.</exception>
    public async Task<DocumentContent> SerializeAsync(DocumentTabViewModel document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var bridge = _bridge ?? throw new BridgeException(BridgeErrorCode.Internal, "El motor no está conectado.");
        await _engineWork.ConfigureAwait(false);
        return await bridge.SendAsync(BridgeCommands.DocumentSerialize, new DocumentRef(document.DocumentId), DocumentCommandTimeout).ConfigureAwait(false);
    }

    /// <summary>
    /// Conecta el modelo de vista con el motor. Devuelve un objeto que, al descartarse, deja de
    /// recibir sus eventos.
    /// </summary>
    public IDisposable AttachBridge(BridgeClient bridge)
    {
        ArgumentNullException.ThrowIfNull(bridge);
        _bridge = bridge;
        var subscriptions = new[]
        {
            bridge.Subscribe(BridgeEvents.EngineReady, OnEngineReady),
            bridge.Subscribe(BridgeEvents.SelectionChanged, OnSelectionChanged),
            bridge.Subscribe(BridgeEvents.DocumentChanged, OnDocumentChanged),
        };
        return new CompositeSubscription(subscriptions, () =>
        {
            if (ReferenceEquals(_bridge, bridge))
            {
                _bridge = null;
                IsEngineReady = false;
            }
        });
    }

    partial void OnSelectedDocumentChanged(DocumentTabViewModel? value)
    {
        SelectionSummary = string.Empty;
        if (value is not null && IsEngineReady)
        {
            Enqueue(() => ActivateAsync(value));
        }
    }

    private void OnEngineReady(EngineReady ready)
    {
        if (ready.ProtocolVersion != BridgeProtocol.Version)
        {
            IsEngineReady = false;
            EngineStatus = _texts.ProtocolMismatch(ready.ProtocolVersion, BridgeProtocol.Version);
            LogProtocolMismatch(ready.EngineVersion, ready.ProtocolVersion, BridgeProtocol.Version);
            return;
        }

        IsEngineReady = true;
        EngineStatus = string.Empty;
        LogEngineReady(ready.EngineVersion, ready.ProtocolVersion);

        // Las pestañas abiertas antes de que el motor estuviera listo se cargan ahora.
        foreach (var document in Documents.ToArray())
        {
            Enqueue(() => LoadAsync(document));
        }

        if (SelectedDocument is { } selected)
        {
            Enqueue(() => ActivateAsync(selected));
        }

        if (_bridge is { } bridge)
        {
            LatencyMeasurement = MeasureLatencyAsync(bridge);
        }
    }

    private async Task LoadAsync(DocumentTabViewModel document)
    {
        if (!Documents.Contains(document))
        {
            return;
        }

        var result = await SendAsync(
            BridgeCommands.DocumentLoad,
            new DocumentLoad(document.DocumentId, document.Title, document.InitialSvg),
            DocumentCommandTimeout);
        if (result is null)
        {
            return;
        }

        document.IsLoaded = result.Loaded;
        document.LoadError = result.Error?.Message;
        document.Revision = result.Revision;
        document.SavedRevision = result.Revision;
        if (!result.Loaded)
        {
            LogLoadFailed(document.DocumentId, result.Error?.Message ?? string.Empty);
        }
    }

    private async Task ActivateAsync(DocumentTabViewModel document)
    {
        if (document.IsLoaded && ReferenceEquals(document, SelectedDocument))
        {
            await SendAsync(BridgeCommands.DocumentActivate, new DocumentRef(document.DocumentId));
        }
    }

    /// <summary>Envía un comando; si falla, lo registra y devuelve null.</summary>
    private async Task<TResponse?> SendAsync<TPayload, TResponse>(
        BridgeCommand<TPayload, TResponse> command,
        TPayload payload,
        TimeSpan? timeout = null)
        where TResponse : class
    {
        if (_bridge is not { } bridge)
        {
            return null;
        }

        try
        {
            return await bridge.SendAsync(command, payload, timeout);
        }
        catch (BridgeException ex)
        {
            LogCommandFailed(command.Name, ex.Code, ex.Message);
            return null;
        }
    }

    private void Enqueue(Func<Task> work)
    {
        var previous = _engineWork;
        _engineWork = RunAfterAsync(previous, work);
    }

    private static async Task RunAfterAsync(Task previous, Func<Task> work)
    {
        await previous;
        await work();
    }

    private async Task MeasureLatencyAsync(BridgeClient bridge)
    {
        var start = _time.GetTimestamp();
        try
        {
            await bridge.SendAsync(BridgeCommands.AppPing, new AppPing(_time.GetUtcNow().ToUnixTimeMilliseconds()));
            BridgeLatency = _time.GetElapsedTime(start);
            LogLatency(BridgeLatency.Value.TotalMilliseconds);
        }
        catch (BridgeException ex)
        {
            BridgeLatency = null;
            LogPingFailed(ex.Code, ex.Message);
        }
    }

    private void OnSelectionChanged(SelectionChanged selection)
    {
        if (selection.DocumentId != SelectedDocument?.DocumentId)
        {
            return;
        }

        SelectionSummary = selection.Items.Count switch
        {
            0 => string.Empty,
            1 => Describe(selection.Items[0]),
            var count => _texts.MultipleSelection(count),
        };
    }

    private void OnDocumentChanged(DocumentState state)
    {
        var document = Documents.FirstOrDefault(d => d.DocumentId == state.DocumentId);
        if (document is not null)
        {
            document.Revision = state.Revision;
        }
    }

    private static string Describe(SelectedElement element) =>
        element.Id is null ? element.TagName : $"{element.TagName}#{element.Id}";

    [LoggerMessage(Level = LogLevel.Information, Message = "Motor {EngineVersion} listo (protocolo {ProtocolVersion})")]
    private partial void LogEngineReady(string engineVersion, int protocolVersion);

    [LoggerMessage(Level = LogLevel.Error, Message = "El motor {EngineVersion} usa el protocolo {EngineProtocol} y la aplicación el {AppProtocol}")]
    private partial void LogProtocolMismatch(string engineVersion, int engineProtocol, int appProtocol);

    [LoggerMessage(Level = LogLevel.Information, Message = "Latencia del puente (app.ping, ida y vuelta): {LatencyMs:0.00} ms")]
    private partial void LogLatency(double latencyMs);

    [LoggerMessage(Level = LogLevel.Warning, Message = "No se pudo medir la latencia del puente ({Code}): {Reason}")]
    private partial void LogPingFailed(BridgeErrorCode code, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "El documento {DocumentId} no se pudo cargar: {Reason}")]
    private partial void LogLoadFailed(string documentId, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Falló el comando {Command} ({Code}): {Reason}")]
    private partial void LogCommandFailed(string command, BridgeErrorCode code, string reason);

    private sealed class CompositeSubscription(IDisposable[] subscriptions, Action onDispose) : IDisposable
    {
        public void Dispose()
        {
            foreach (var subscription in subscriptions)
            {
                subscription.Dispose();
            }

            onDispose();
        }
    }
}
