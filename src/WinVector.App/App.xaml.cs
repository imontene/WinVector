using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml;

namespace WinVector.App;

/// <summary>
/// Punto de entrada de la aplicación.
/// </summary>
public partial class App : Application
{
    private MainWindow? _window;

    /// <summary>
    /// Registro de la aplicación. Por ahora escribe en la salida de depuración (Visual Studio o
    /// DebugView); un registro en archivo llegará cuando haga falta diagnosticar en equipos de usuarios.
    /// </summary>
    public static ILoggerFactory Logging { get; } = LoggerFactory.Create(builder => builder
        .AddDebug()
#if DEBUG
        .SetMinimumLevel(LogLevel.Debug));
#else
        .SetMinimumLevel(LogLevel.Information));
#endif

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
