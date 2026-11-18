using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Estado de la ventana principal: pestañas de documento, pestaña activa y estado del lienzo.
/// </summary>
public sealed partial class MainViewModel : ObservableObject
{
    private readonly ShellTexts _texts;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private int _untitledCount;

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

    /// <summary>Abre un documento nuevo vacío y lo activa.</summary>
    [RelayCommand]
    public void NewDocument()
    {
        _untitledCount++;
        var document = new DocumentTabViewModel(_texts.UntitledDocument(_untitledCount));
        Documents.Add(document);
        SelectedDocument = document;
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

        if (Documents.Count == 0)
        {
            NewDocument();
        }
        else if (wasSelected)
        {
            SelectedDocument = Documents[Math.Min(index, Documents.Count - 1)];
        }
    }

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

    /// <summary>
    /// Conecta el modelo de vista con el motor. Devuelve un objeto que, al descartarse, deja de
    /// recibir sus eventos.
    /// </summary>
    public IDisposable AttachBridge(BridgeClient bridge)
    {
        ArgumentNullException.ThrowIfNull(bridge);
        var subscriptions = new[]
        {
            bridge.Subscribe(BridgeEvents.EngineReady, ready => OnEngineReady(bridge, ready)),
            bridge.Subscribe(BridgeEvents.SelectionChanged, OnSelectionChanged),
        };
        return new CompositeSubscription(subscriptions);
    }

    private void OnEngineReady(BridgeClient bridge, EngineReady ready)
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
        LatencyMeasurement = MeasureLatencyAsync(bridge);
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
        SelectionSummary = selection.Items.Count switch
        {
            0 => string.Empty,
            1 => Describe(selection.Items[0]),
            var count => _texts.MultipleSelection(count),
        };
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

    private sealed class CompositeSubscription(IDisposable[] subscriptions) : IDisposable
    {
        public void Dispose()
        {
            foreach (var subscription in subscriptions)
            {
                subscription.Dispose();
            }
        }
    }
}
