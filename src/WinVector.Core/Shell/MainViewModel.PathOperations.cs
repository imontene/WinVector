using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Operaciones del menú Trazado y regla de relleno (issue #79).</summary>
public sealed partial class MainViewModel
{
    /// <summary>
    /// Regla de relleno común de la selección, o null si los objetos tienen reglas distintas o no hay
    /// selección.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SelectionFillRuleIndex))]
    private FillRule? _selectionFillRule;

    /// <summary>Índice de la regla en la lista del panel: 0 nonzero, 1 evenodd, -1 ninguna o varias.</summary>
    public int SelectionFillRuleIndex => SelectionFillRule switch
    {
        FillRule.Nonzero => 0,
        FillRule.Evenodd => 1,
        _ => -1,
    };

    /// <summary>Cambia la regla de relleno de la selección.</summary>
    /// <returns>False si ya era esa o no hay nada seleccionado.</returns>
    public bool SetSelectionFillRule(FillRule rule) => rule != SelectionFillRule && SendStyle(fillRule: rule);

    /// <summary>Cierra los trazados abiertos de la selección.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task ClosePathAsync() => PathOperationAsync(PathOperationKind.Close);

    /// <summary>Abre los trazados cerrados; con la herramienta Vértices, por el nodo seleccionado.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task OpenPathAsync() => PathOperationAsync(PathOperationKind.Open);

    /// <summary>Invierte la dirección de los trazados seleccionados.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task ReversePathAsync() => PathOperationAsync(PathOperationKind.Reverse);

    /// <summary>Combina las formas seleccionadas en un trazado con varios subtrazados.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task CombinePathsAsync() => PathOperationAsync(PathOperationKind.Combine);

    /// <summary>Separa los trazados seleccionados en un trazado por subtrazado.</summary>
    [RelayCommand(CanExecute = nameof(HasSelection))]
    public Task SeparatePathAsync() => PathOperationAsync(PathOperationKind.Separate);

    private Task PathOperationAsync(PathOperationKind operation)
    {
        if (SelectedDocument is not { IsLoaded: true } document)
        {
            return Task.CompletedTask;
        }

        Enqueue(() => SendAsync(BridgeCommands.PathOperation, new PathOperation(document.DocumentId, operation)));
        return _engineWork;
    }

    private void NotifyPathOperationsChanged()
    {
        ClosePathCommand.NotifyCanExecuteChanged();
        OpenPathCommand.NotifyCanExecuteChanged();
        ReversePathCommand.NotifyCanExecuteChanged();
        CombinePathsCommand.NotifyCanExecuteChanged();
        SeparatePathCommand.NotifyCanExecuteChanged();
    }
}
