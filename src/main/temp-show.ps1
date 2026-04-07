Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public static void Show() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) {
            ShowWindow(shellView, 5);
            PostMessage(progman, 0x0111, new IntPtr(0x7402), IntPtr.Zero);
        }
    }
}
"@
[DesktopHelper]::Show()