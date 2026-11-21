using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Nodos de los trazados (issue #77): con la herramienta Vértices en un trazado, el menú Trazado y el
/// panel cambian el tipo de los nodos seleccionados y el de los segmentos entre ellos.
/// </summary>
public sealed partial class MainViewModel
{
    /// <summary>Número de nodos seleccionados del trazado que se edita; 0 si no se edita un trazado.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelectedNodes), nameof(SelectedNodesText))]
    [NotifyCanExecuteChangedFor(nameof(MakeNodesCornerCommand))]
    private int _selectedNodeCount;

    /// <summary>Tipo común de los nodos seleccionados con dos lados, o null si ninguno los tiene.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectedNodesText))]
    private NodeKind? _selectedNodeKind;

    /// <summary>Algún nodo seleccionado tiene dos lados: puede ser suave o simétrico.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(MakeNodesSmoothCommand), nameof(MakeNodesSymmetricCommand))]
    private bool _canSmoothNodes;

    /// <summary>Algún segmento entre dos nodos seleccionados no es recto.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(MakeSegmentsLineCommand))]
    private bool _canMakeSegmentsLine;

    /// <summary>Algún segmento entre dos nodos seleccionados no es una curva.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(MakeSegmentsCurveCommand))]
    private bool _canMakeSegmentsCurve;

    /// <summary>Hay nodos de un trazado seleccionados: el panel muestra sus órdenes.</summary>
    public bool HasSelectedNodes => SelectedNodeCount > 0;

    /// <summary>Resumen para el panel ("2 nodos · Suave").</summary>
    public string SelectedNodesText => HasSelectedNodes ? _texts.SelectedNodes(SelectedNodeCount, SelectedNodeKind) : string.Empty;

    /// <summary>Hace esquina los nodos seleccionados: recoge sus manejadores.</summary>
    [RelayCommand(CanExecute = nameof(HasSelectedNodes))]
    public Task MakeNodesCornerAsync() => PathNodesAsync(NodeAction.Corner);

    /// <summary>Hace suaves los nodos seleccionados: alinea sus manejadores.</summary>
    [RelayCommand(CanExecute = nameof(CanSmoothNodes))]
    public Task MakeNodesSmoothAsync() => PathNodesAsync(NodeAction.Smooth);

    /// <summary>Hace simétricos los nodos seleccionados: manejadores alineados y de la misma longitud.</summary>
    [RelayCommand(CanExecute = nameof(CanSmoothNodes))]
    public Task MakeNodesSymmetricAsync() => PathNodesAsync(NodeAction.Symmetric);

    /// <summary>Hace rectos los segmentos entre nodos seleccionados.</summary>
    [RelayCommand(CanExecute = nameof(CanMakeSegmentsLine))]
    public Task MakeSegmentsLineAsync() => PathNodesAsync(NodeAction.Line);

    /// <summary>Hace curvos los segmentos entre nodos seleccionados, sin cambiar lo que se ve.</summary>
    [RelayCommand(CanExecute = nameof(CanMakeSegmentsCurve))]
    public Task MakeSegmentsCurveAsync() => PathNodesAsync(NodeAction.Curve);

    private Task PathNodesAsync(NodeAction action)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(BridgeCommands.PathNodes, new PathNodesChange(document.DocumentId, action)));
        return _engineWork;
    }

    private void OnNodesChanged(NodeSelection selection)
    {
        if (selection.DocumentId == SelectedDocument?.DocumentId)
        {
            ShowNodes(selection);
        }
    }

    /// <summary>Muestra los nodos seleccionados, o ninguno con null (otro documento, sin trazado).</summary>
    private void ShowNodes(NodeSelection? selection)
    {
        SelectedNodeCount = selection?.Count ?? 0;
        SelectedNodeKind = selection?.Kind;
        CanSmoothNodes = selection?.CanSmooth ?? false;
        CanMakeSegmentsLine = selection?.CanMakeLine ?? false;
        CanMakeSegmentsCurve = selection?.CanMakeCurve ?? false;
    }
}
