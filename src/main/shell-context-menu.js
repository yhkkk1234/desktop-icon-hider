/* eslint-disable quotes */
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CSHARP_SOURCE = `using System;
using System.IO;
using System.Text;
using System.Windows.Forms;
using System.Runtime.InteropServices;

[ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellFolder
{
    void ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string pszDisplayName, out uint pchEaten, out IntPtr ppidl, ref uint pdwAttributes);
    void EnumObjects(IntPtr hwnd, uint grfFlags, out IntPtr enumIDList);
    void BindToObject(IntPtr pidl, IntPtr pbc, [In] ref Guid riid, out IShellFolder ppv);
    void BindToStorage(IntPtr pidl, IntPtr pbc, [In] ref Guid riid, out IntPtr ppv);
    void CompareIDs(IntPtr lParam, IntPtr pidl1, IntPtr pidl2);
    [PreserveSig] int CreateViewObject(IntPtr hwndOwner, [In] ref Guid riid, out IntPtr ppv);
    void GetAttributesOf(uint cidl, IntPtr apidl, ref uint rgfInOut);
    [PreserveSig] int GetUIObjectOf(IntPtr hwndOwner, uint cidl, ref IntPtr apidl, [In] ref Guid riid, IntPtr rgfReserved, out IntPtr ppv);
    void GetDisplayNameOf(IntPtr pidl, uint uFlags, IntPtr pName);
    void SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string pszName, uint uFlags, out IntPtr ppidlOut);
}

[ComImport, Guid("000214E5-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellView
{
    [PreserveSig] int GetWindow(out IntPtr phwnd);
    void ContextSensitiveHelp(bool fEnterMode);
    void TranslateAccelerator(ref MSG pmsg);
    void EnableModeless(bool fEnable);
    void UIActivate(uint uState);
    void Refresh();
    void CreateViewWindow(IShellView psvPrevious, ref FOLDERSETTINGS pfs, IntPtr psb, ref RECT prcView, out IntPtr phWnd);
    void DestroyViewWindow();
    void GetCurrentInfo(ref FOLDERSETTINGS lpfs);
    int AddPropertySheetPages(uint dwReserved, IntPtr pfn, IntPtr lParam);
    void SaveViewState();
    void SelectObject(IntPtr pidlItem, uint uFlags);
    [PreserveSig] int GetItemObject(uint uItem, [In] ref Guid riid, out IntPtr ppv);
}

[StructLayout(LayoutKind.Sequential)]
struct FOLDERSETTINGS
{
    public uint ViewMode;
    public uint fFlags;
}

[StructLayout(LayoutKind.Sequential)]
struct RECT
{
    public int left, top, right, bottom;
}

[StructLayout(LayoutKind.Sequential)]
struct MSG
{
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x, pt_y;
}

[ComImport, Guid("000214e4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IContextMenu
{
    [PreserveSig] int QueryContextMenu(IntPtr hMenu, uint indexMenu, int idCmdFirst, int idCmdLast, uint uFlags);
    void InvokeCommand(IntPtr pici);
    void GetCommandString(IntPtr idCmd, uint uType, IntPtr pReserved, StringBuilder pszName, uint cchMax);
}

[ComImport, Guid("000214f4-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IContextMenu2 : IContextMenu
{
    [PreserveSig] new int QueryContextMenu(IntPtr hMenu, uint indexMenu, int idCmdFirst, int idCmdLast, uint uFlags);
    new void InvokeCommand(IntPtr pici);
    new void GetCommandString(IntPtr idCmd, uint uType, IntPtr pReserved, StringBuilder pszName, uint cchMax);
    [PreserveSig] int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
}

[ComImport, Guid("bcfce0a0-ec17-11d0-8d10-00a0c90f2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IContextMenu3 : IContextMenu2
{
    [PreserveSig] new int QueryContextMenu(IntPtr hMenu, uint indexMenu, int idCmdFirst, int idCmdLast, uint uFlags);
    new void InvokeCommand(IntPtr pici);
    new void GetCommandString(IntPtr idCmd, uint uType, IntPtr pReserved, StringBuilder pszName, uint cchMax);
    [PreserveSig] new int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
    [PreserveSig] int HandleMenuMsg2(uint uMsg, IntPtr wParam, IntPtr lParam, out IntPtr plResult);
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct CMINVOKECOMMANDINFO
{
    public uint cbSize;
    public uint fMask;
    public IntPtr hwnd;
    public IntPtr lpVerb;
    [MarshalAs(UnmanagedType.LPStr)] public string lpParameters;
    [MarshalAs(UnmanagedType.LPStr)] public string lpDirectory;
    public int nShow;
    public uint dwHotKey;
    public IntPtr hIcon;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct CMINVOKECOMMANDINFOEX
{
    public uint cbSize;
    public uint fMask;
    public IntPtr hwnd;
    public IntPtr lpVerb;
    [MarshalAs(UnmanagedType.LPStr)] public string lpParameters;
    [MarshalAs(UnmanagedType.LPStr)] public string lpDirectory;
    public int nShow;
    public uint dwHotKey;
    public IntPtr hIcon;
    [MarshalAs(UnmanagedType.LPStr)] public string lpTitle;
    public uint dwHotKey2;
    public IntPtr hIcon2;
}

class ContextMenuWindow : Form
{
    private IContextMenu3 _ctxMenu3;

    protected override void SetVisibleCore(bool value)
    {
        base.SetVisibleCore(false);
    }

    protected override void WndProc(ref Message m)
    {
        if (_ctxMenu3 != null)
        {
            switch (m.Msg)
            {
                case 0x0117:
                case 0x002C:
                case 0x002B:
                    try
                    {
                        IntPtr lResult;
                        int hr = _ctxMenu3.HandleMenuMsg2((uint)m.Msg, m.WParam, m.LParam, out lResult);
                        if (hr >= 0)
                        {
                            m.Result = lResult;
                            return;
                        }
                    }
                    catch { }
                    break;
            }
        }
        base.WndProc(ref m);
    }

    public int ShowDesktopContextMenu(int x, int y)
    {
        try
        {
            POINT scaledPt = ScalePoint(x, y);
            x = scaledPt.x;
            y = scaledPt.y;

            IntPtr progman = FindWindow("Progman", null);
            if (progman == IntPtr.Zero) return -1;

            IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            
            if (shellView == IntPtr.Zero)
            {
                IntPtr workerW = IntPtr.Zero;
                while ((workerW = FindWindowEx(IntPtr.Zero, workerW, "WorkerW", null)) != IntPtr.Zero)
                {
                    shellView = FindWindowEx(workerW, IntPtr.Zero, "SHELLDLL_DefView", null);
                    if (shellView != IntPtr.Zero) break;
                }
            }
            
            if (shellView == IntPtr.Zero) return -1;

            _lastShellView = shellView;

            POINT pt = new POINT { x = x, y = y };
            ScreenToClient(shellView, ref pt);

            IntPtr lParam = (IntPtr)((pt.y << 16) | (pt.x & 0xFFFF));
            IntPtr wParam = IntPtr.Zero;

            SendMessage(shellView, 0x0204, wParam, lParam);
            SendMessage(shellView, 0x0205, wParam, lParam);

            DateTime startTime = DateTime.Now;
            bool menuActive = true;
            int menuCheckDelay = 0;
            const int MAX_WAIT_MINUTES = 2;
            const string MENU_CLASS = "#32768";

            while (menuActive)
            {
                if ((DateTime.Now - startTime).TotalMinutes > MAX_WAIT_MINUTES)
                    break;

                MSG msg;
                int hasMsg = PeekMessage(out msg, IntPtr.Zero, 0, 0, 1);
                if (hasMsg != 0)
                {
                    if (msg.message == 0x0012)
                        break;
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }
                else
                {
                    System.Threading.Thread.Sleep(2);
                    menuCheckDelay++;

                    if (menuCheckDelay >= 10)
                    {
                        menuCheckDelay = 0;
                        IntPtr foregroundWnd = GetForegroundWindow();
                        if (foregroundWnd != IntPtr.Zero)
                        {
                            StringBuilder className = new StringBuilder(256);
                            GetClassName(foregroundWnd, className, 256);
                            string clsName = className.ToString();
                            if (clsName != MENU_CLASS)
                            {
                                System.Threading.Thread.Sleep(20);
                                IntPtr checkWnd = GetForegroundWindow();
                                if (checkWnd != IntPtr.Zero)
                                {
                                    StringBuilder checkClass = new StringBuilder(256);
                                    GetClassName(checkWnd, checkClass, 256);
                                    if (checkClass.ToString() != MENU_CLASS)
                                    {
                                        menuActive = false;
                                    }
                                }
                                else
                                {
                                    menuActive = false;
                                }
                            }
                        }
                        else
                        {
                            menuActive = false;
                        }
                    }
                }
            }

            return 0;
        }
        catch
        {
            return -1;
        }
    }

    public void CancelDesktopContextMenu()
    {
        try
        {
            const string MENU_CLASS = "#32768";
            IntPtr menuHwnd = FindWindow(MENU_CLASS, null);
            
            if (menuHwnd != IntPtr.Zero)
            {
                SendMessage(menuHwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
            }
            
            if (_lastShellView != IntPtr.Zero)
            {
                SendMessage(_lastShellView, 0x001F, IntPtr.Zero, IntPtr.Zero);
                _lastShellView = IntPtr.Zero;
            }
        }
        catch { }
    }

    private IntPtr _lastShellView = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential)]
    struct POINT
    {
        public int x;
        public int y;
    }

    public int ShowFileContextMenu(string filePath, int x, int y)
    {
        POINT scaledPt = ScalePoint(x, y);
        x = scaledPt.x;
        y = scaledPt.y;

        IShellFolder desktop = null;
        IShellFolder parentFolder = null;
        IntPtr fullPidl = IntPtr.Zero;
        IntPtr relativePidl = IntPtr.Zero;
        IntPtr hMenu = IntPtr.Zero;
        IntPtr ppvCtx = IntPtr.Zero;
        object parentObj = null;
        IntPtr childPidl = IntPtr.Zero;

        try
        {
            int hr = SHGetDesktopFolder(out desktop);
            if (hr != 0 || desktop == null) return -1;

            uint sfgaoOut;
            hr = SHParseDisplayName(filePath, IntPtr.Zero, out fullPidl, 0, out sfgaoOut);
            if (hr != 0 || fullPidl == IntPtr.Zero) return -1;

            Guid riidFolder = typeof(IShellFolder).GUID;
            hr = SHBindToParent(fullPidl, ref riidFolder, out parentObj, out childPidl);
            if (hr != 0 || parentObj == null || childPidl == IntPtr.Zero) return -1;

            parentFolder = (IShellFolder)parentObj;
            relativePidl = ILClone(childPidl);
            if (relativePidl == IntPtr.Zero) return -1;

            Guid iidCtx = typeof(IContextMenu).GUID;
            hr = parentFolder.GetUIObjectOf(this.Handle, 1, ref relativePidl, ref iidCtx, IntPtr.Zero, out ppvCtx);
            if (hr != 0 || ppvCtx == IntPtr.Zero) return -1;

            _ctxMenu3 = Marshal.GetObjectForIUnknown(ppvCtx) as IContextMenu3;
            if (_ctxMenu3 == null) return -1;

            hMenu = CreatePopupMenu();
            if (hMenu == IntPtr.Zero) return -1;

            uint flags = 0x00000004 | 0x00000100 | 0x00000400;
            int result = _ctxMenu3.QueryContextMenu(hMenu, 0, 1, 0x7FFF, flags);
            if (result <= 0) return -1;

            uint tpmFlags = 0x0100;
            SetForegroundWindow(this.Handle);
            int cmd = (int)(long)TrackPopupMenuEx(hMenu, tpmFlags, x, y, this.Handle, IntPtr.Zero);
            PostMessage(this.Handle, 0x0000, IntPtr.Zero, IntPtr.Zero);
            DestroyMenu(hMenu);
            hMenu = IntPtr.Zero;

            if (cmd > 0)
            {
                InvokeCommand(_ctxMenu3, cmd - 1);
                WaitForDialogToClose();
            }
            return 0;
        }
        catch
        {
            return -1;
        }
        finally
        {
            if (hMenu != IntPtr.Zero) DestroyMenu(hMenu);
            if (fullPidl != IntPtr.Zero) ILFree(fullPidl);
            if (relativePidl != IntPtr.Zero) ILFree(relativePidl);
            if (ppvCtx != IntPtr.Zero) Marshal.Release(ppvCtx);
            _ctxMenu3 = null;
        }
    }

    private void WaitForDialogToClose()
    {
        try
        {
            DateTime waitStart = DateTime.Now;
            IntPtr dialogHwnd = IntPtr.Zero;

            while ((DateTime.Now - waitStart).TotalSeconds < 0.5)
            {
                MSG msg;
                int hasMsg = PeekMessage(out msg, IntPtr.Zero, 0, 0, 1);
                if (hasMsg != 0)
                {
                    if (msg.message == 0x0012) return;
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }
                else
                {
                    dialogHwnd = GetForegroundWindow();
                    if (dialogHwnd != this.Handle && dialogHwnd != IntPtr.Zero)
                    {
                        StringBuilder className = new StringBuilder(256);
                        GetClassName(dialogHwnd, className, 256);
                        string cls = className.ToString();
                        if (cls == "#32777" || cls == "#32768" || !cls.StartsWith("#"))
                        {
                            break;
                        }
                    }
                    System.Threading.Thread.Sleep(2);
                }
            }

            if (dialogHwnd != IntPtr.Zero && dialogHwnd != this.Handle && IsWindow(dialogHwnd))
            {
                SetForegroundWindow(dialogHwnd);
                DateTime dialogStart = DateTime.Now;
                while ((DateTime.Now - dialogStart).TotalSeconds < 30 && IsWindow(dialogHwnd))
                {
                    MSG msg;
                    int hasMsg = PeekMessage(out msg, IntPtr.Zero, 0, 0, 1);
                    if (hasMsg != 0)
                    {
                        if (msg.message == 0x0012) return;
                        TranslateMessage(ref msg);
                        DispatchMessage(ref msg);
                    }
                    else
                    {
                        System.Threading.Thread.Sleep(5);
                    }
                }
            }
        }
        catch { }
    }

    private void InvokeCommand(IContextMenu ctxMenu, int cmdIndex)
    {
        try
        {
            CMINVOKECOMMANDINFOEX info = new CMINVOKECOMMANDINFOEX();
            info.cbSize = (uint)Marshal.SizeOf(typeof(CMINVOKECOMMANDINFOEX));
            info.fMask = 0x00004000;
            info.hwnd = this.Handle;
            info.lpVerb = (IntPtr)cmdIndex;
            info.nShow = 1;

            IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(info));
            Marshal.StructureToPtr(info, ptr, false);
            ctxMenu.InvokeCommand(ptr);
            Marshal.FreeHGlobal(ptr);
        }
        catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        try
        {
            // 启用 DPI 感知，解决菜单模糊问题
            try { SetProcessDPIAware(); } catch { }
            
            if (args.Length < 1)
            {
                Environment.Exit(1);
                return;
            }

            string mode = args[0];
            ContextMenuWindow window = new ContextMenuWindow();
            window.CreateControl();

            if (mode == "desktop" && args.Length >= 3)
            {
                int x = int.Parse(args[1]);
                int y = int.Parse(args[2]);
                int result = window.ShowDesktopContextMenu(x, y);
                Environment.Exit(result >= 0 ? 0 : 1);
            }
            else if (mode == "file" && args.Length >= 4)
            {
                int x = int.Parse(args[1]);
                int y = int.Parse(args[2]);
                string filePath = args[3];
                for (int i = 4; i < args.Length; i++)
                {
                    filePath += " " + args[i];
                }
                int result = window.ShowFileContextMenu(filePath, x, y);
                Environment.Exit(result >= 0 ? 0 : 1);
            }
            else if (mode == "cancel")
            {
                window.CancelDesktopContextMenu();
                Environment.Exit(0);
            }
            else
            {
                Environment.Exit(1);
            }
        }
        catch
        {
            Environment.Exit(1);
        }
    }

    [DllImport("user32.dll")]
    static extern IntPtr TrackPopupMenuEx(IntPtr hmenu, uint fuFlags, int x, int y, IntPtr hwnd, IntPtr lptpm);

    [DllImport("user32.dll")]
    static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll")]
    static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("shell32.dll")]
    static extern int SHGetDesktopFolder(out IShellFolder ppshf);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHParseDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr bindingContext, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);

    [DllImport("shell32.dll")]
    static extern int SHBindToParent(IntPtr pidl, [In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv, out IntPtr ppidlLast);

    [DllImport("shell32.dll")]
    static extern void ILFree(IntPtr pidl);

    [DllImport("shell32.dll")]
    static extern IntPtr ILClone(IntPtr pidl);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern IntPtr GetDesktopWindow();

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll")]
    static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern int PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    static extern int GetDeviceCaps(IntPtr hDC, int nIndex);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr ShellExecute(IntPtr hwnd, string lpOperation, string lpFile, string lpParameters, string lpDirectory, int nShowCmd);

    private static int GetDpiScale()
    {
        const int LOGPIXELSX = 88;
        IntPtr hDC = GetDC(IntPtr.Zero);
        int dpi = GetDeviceCaps(hDC, LOGPIXELSX);
        ReleaseDC(IntPtr.Zero, hDC);
        return dpi;
    }

    private static POINT ScalePoint(int x, int y)
    {
        int dpi = GetDpiScale();
        int scaledX = (int)(x * dpi / 96.0);
        int scaledY = (int)(y * dpi / 96.0);
        return new POINT { x = scaledX, y = scaledY };
    }
}
`;

let compiledExePath = null;

function findCscExe() {
  const candidates = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const result = execSync('where csc.exe 2>nul', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = result.trim().split('\n');
    if (lines.length > 0 && fs.existsSync(lines[0].trim())) {
      return lines[0].trim();
    }
  } catch (e) { /* csc.exe not in PATH */ }

  return null;
}

function compileExe() {
  if (compiledExePath && fs.existsSync(compiledExePath)) {
    return compiledExePath;
  }

  const tempDir = os.tmpdir();
  const exeName = 'ShellContextMenu.exe';
  const exePath = path.join(tempDir, exeName);
  const csPath = path.join(tempDir, 'ShellContextMenu.cs');

  const cscPath = findCscExe();
  if (!cscPath) {
    return null;
  }

  try {
    fs.writeFileSync(csPath, CSHARP_SOURCE, 'utf8');

    const compileCmd = `"${cscPath}" /target:winexe /out:"${exePath}" /r:System.Windows.Forms.dll /r:System.Drawing.dll "${csPath}"`;
    
    execSync(compileCmd, {
      timeout: 30000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    try { fs.unlinkSync(csPath); } catch (e) { /* ignore */ }

    if (fs.existsSync(exePath)) {
      compiledExePath = exePath;
      return exePath;
    }
    return null;
  } catch (error) {
    try { fs.unlinkSync(csPath); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(exePath); } catch (e) { /* ignore */ }
    return null;
  }
}

function showDesktopContextMenu(x, y) {
  const exePath = compileExe();
  if (!exePath) return Promise.resolve(false);

  return new Promise((resolve) => {
    exec(`"${exePath}" desktop ${x} ${y}`, {
      timeout: 30000,
      windowsHide: true
    }, (error) => {
      if (!error || (error && error.status === 0)) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

function showFileContextMenu(filePath, x, y) {
  const exePath = compileExe();
  if (!exePath) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const args = `file ${x} ${y}`;
    const cmd = `"${exePath}" ${args} "${filePath}"`;
    exec(cmd, {
      timeout: 30000,
      windowsHide: true
    }, (error) => {
      if (!error || (error && error.status === 0)) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

function cancelDesktopContextMenu() {
  const exePath = compileExe();
  if (!exePath) return Promise.resolve(false);

  return new Promise((resolve) => {
    exec(`"${exePath}" cancel`, {
      timeout: 5000,
      windowsHide: true
    }, () => {
      resolve(true);
    });
  });
}

function shutdownService() {
  // No persistent service in this version
}

module.exports = {
  showDesktopContextMenu,
  showFileContextMenu,
  cancelDesktopContextMenu,
  compileExe,
  shutdownService
};
