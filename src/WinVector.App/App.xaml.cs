using Microsoft.UI.Xaml;

namespace WinVector.App;

/// <summary>
/// Punto de entrada de la aplicación.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
