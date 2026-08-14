# check-desktop-icons.ps1 - Verify desktop icons visibility (SHELLDLL_DefView IsWindowVisible)
$ErrorActionPreference = 'Stop'
try {
  $code = @'
using System;
using System.Runtime.InteropServices;
public class DesktopCheck {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    public static bool Check() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView == IntPtr.Zero) {
            IntPtr worker = IntPtr.Zero;
            while ((worker = FindWindowEx(IntPtr.Zero, worker, "WorkerW", null)) != IntPtr.Zero) {
                shellView = FindWindowEx(worker, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (shellView != IntPtr.Zero) break;
            }
        }
        if (shellView == IntPtr.Zero) return false;
        return IsWindowVisible(shellView);
    }
}
'@
  Add-Type -TypeDefinition $code
  [DesktopCheck]::Check()
} catch {
  Write-Output "false"
}
