using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Menú contextual del lienzo (issue #73).</summary>
public sealed partial class MainViewModel
{
    /// <summary>El lienzo pide abrir el menú contextual; la interfaz lo abre en el punto indicado.</summary>
    public event EventHandler<ContextMenuRequestedEventArgs>? ContextMenuRequested;

    /// <summary>Lo seleccionado es una sola forma que se puede editar por vértices.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(EditVerticesCommand))]
    private bool _canEditVertices;

    /// <summary>Pasa a la herramienta Vértices con la forma seleccionada.</summary>
    [RelayCommand(CanExecute = nameof(CanEditVertices))]
    public Task EditVerticesAsync() => SelectToolAsync(ToolName.Vertex);

    private void OnContextMenu(ContextMenuRequest request)
    {
        if (request.DocumentId != SelectedDocument?.DocumentId)
        {
            return;
        }

        CanEditVertices = request.CanEditVertices;
        ContextMenuRequested?.Invoke(this, new ContextMenuRequestedEventArgs(request.X, request.Y, request.Keyboard));
    }
}
