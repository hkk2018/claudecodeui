import express from 'express';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync } from 'fs';

const execAsync = promisify(exec);
const router = express.Router();

// POST /api/overlay/launch
router.post('/launch', async (req, res) => {
    const { width = 420, height = 700 } = req.body || {};
    const port = req.app.locals.port || 9001;
    const url = `http://localhost:${port}`;

    try {
        const chrome = spawn('google-chrome', [
            `--app=${url}`,
            `--window-size=${width},${height}`,
            '--new-window',
        ], {
            detached: true,
            stdio: 'ignore',
        });
        chrome.unref();

        // TODO: fix - wmctrl always-on-top not working (user can manually pin via desktop)
        setTimeout(async () => {
            const env = { ...process.env, DISPLAY: await resolveDisplay() };
            exec(`wmctrl -r "Claude Code UI" -b add,above`, { env }, (err) => {
                if (err) {
                    // Fallback: try matching by localhost URL
                    exec(`wmctrl -r "localhost:${port}" -b add,above`, { env }, () => {});
                }
            });
        }, 2000);

        res.json({ success: true, message: 'Overlay window launched' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/overlay/pin - toggle always-on-top
router.post('/pin', async (req, res) => {
    const { pin = true } = req.body || {};
    const port = req.app.locals.port || 9001;
    const action = pin ? 'add' : 'remove';
    const env = { ...process.env, DISPLAY: await resolveDisplay() };

    exec(`wmctrl -r "Claude Code UI" -b ${action},above`, { env }, (err) => {
        if (err) {
            exec(`wmctrl -r "localhost:${port}" -b ${action},above`, { env }, (err2) => {
                if (err2) {
                    return res.status(500).json({ success: false, error: 'Window not found' });
                }
                res.json({ success: true, pinned: pin });
            });
        } else {
            res.json({ success: true, pinned: pin });
        }
    });
});

// Map wmctrl WM_CLASS → editor type. wmctrl -lx prints "instance.Class".
const WM_CLASS_TO_EDITOR = {
    'cursor.Cursor': 'cursor',
    'code.Code': 'vscode',
};

// Resolve which X DISPLAY actually has the user's desktop (and IDE windows) on it.
//
// History of this resolution logic — both prior versions broke on a wrong
// assumption about which displays exist:
//   v1: hardcoded ':1' fallback → broke when DCV came up on a different number
//       ("Cannot open display" → empty list).
//   v2: probe :0/:1/:2, use the FIRST display that opens → broke when gdm's
//       greeter Xorg sat on :0 accepting connections but managing zero windows,
//       while the real DCV desktop was on :1. wmctrl on :0 succeeded with empty
//       output, got cached, and the UI showed "No IDE windows" forever.
// /tmp/.X11-unix can't disambiguate either (the greeter's socket looks the same
// as the desktop's), so openability and socket presence are both insufficient.
//
// v3: probe ALL candidates and pick by CONTENT — the display with IDE windows
// wins; with none anywhere, the one managing the most windows (the real desktop
// has Chrome/terminals; a greeter has nothing). The winner is cached and trusted
// only while it still shows IDE windows; once it goes IDE-less we re-probe every
// call, which is what makes a wrongly-cached empty display self-heal.
//
// v4: candidates are discovered from /tmp/.X11-unix sockets, not a fixed list.
// xrdp/Xvnc desktops sit on :10+ (a new xrdp machine put the IDEs on :10), which
// the old [:0,:1,:2] list never probed → "No IDE windows". We still union in
// :0–:2 as a fallback, and cap at <100 to skip xrdp chansrv sockets (:1001 etc).
function getDisplayCandidates() {
    const candidates = new Set([':0', ':1', ':2']);
    try {
        for (const name of readdirSync('/tmp/.X11-unix')) {
            const m = name.match(/^X(\d+)$/);
            if (m && Number(m[1]) < 100) candidates.add(':' + m[1]);
        }
    } catch {
        // /tmp/.X11-unix unreadable — fall back to the seeded :0–:2
    }
    return [...candidates];
}
let cachedDisplay = null;
// Result of the last full probe, exposed via /ide-projects for debuggability —
// when the wrong display gets picked, this shows what each candidate looked like.
let lastProbe = null;

async function wmctrlOn(display) {
    const { stdout } = await execAsync('wmctrl -lx', {
        env: { ...process.env, DISPLAY: display },
        timeout: 3000,
    });
    return stdout;
}

// Count managed windows / IDE windows in `wmctrl -lx` output.
function countWindows(stdout) {
    let total = 0;
    let ide = 0;
    for (const line of stdout.split('\n')) {
        const m = line.match(/^0x[0-9a-fA-F]+\s+-?\d+\s+(\S+)\s/);
        if (!m) continue;
        total++;
        if (WM_CLASS_TO_EDITOR[m[1]]) ide++;
    }
    return { total, ide };
}

// Run `wmctrl -lx` against the display that actually has the desktop on it,
// returning its stdout + the display that produced it. Throws only when no
// candidate display opens at all.
async function wmctrlList() {
    // An explicit DISPLAY (operator-set) wins and is the only candidate.
    if (process.env.DISPLAY) {
        const stdout = await wmctrlOn(process.env.DISPLAY);
        return { display: process.env.DISPLAY, stdout };
    }

    // Fast path: the cached display is trusted only while it still has IDE
    // windows. An IDE-less result falls through to the full probe — it may just
    // mean all IDEs are closed, but it's also the signature of having cached a
    // greeter display, and the probe distinguishes the two.
    if (cachedDisplay) {
        try {
            const stdout = await wmctrlOn(cachedDisplay);
            if (countWindows(stdout).ide > 0) return { display: cachedDisplay, stdout };
        } catch {
            // cached display died (X restart) — fall through to re-probe
        }
    }

    // Full probe: score every candidate, prefer IDE windows, then total windows.
    const candidates = getDisplayCandidates();
    let best = null;
    let lastErr = null;
    const probe = [];
    for (const display of candidates) {
        try {
            const stdout = await wmctrlOn(display);
            const { total, ide } = countWindows(stdout);
            probe.push({ display, windows: total, ideWindows: ide });
            if (!best || ide > best.ide || (ide === best.ide && total > best.total)) {
                best = { display, stdout, total, ide };
            }
        } catch (err) {
            probe.push({ display, error: err.message.split('\n')[0] });
            lastErr = err;
        }
    }
    lastProbe = probe;
    if (!best) {
        throw lastErr || new Error('No X display available (tried ' + candidates.join(', ') + ')');
    }
    cachedDisplay = best.display;
    return { display: best.display, stdout: best.stdout };
}

// Best-effort display for focus/pin/launch commands that don't list windows.
// Never throws — a wrong guess just makes the subsequent wmctrl command fail and
// report its own error, and the next ide-projects poll re-detects the display.
async function resolveDisplay() {
    if (process.env.DISPLAY) return process.env.DISPLAY;
    if (cachedDisplay) return cachedDisplay;
    try {
        const { display } = await wmctrlList();
        return display;
    } catch {
        return ':1';
    }
}

// Enumerate open IDE windows via a SINGLE `wmctrl -lx` call.
//
// Why wmctrl (not the old per-window xdotool loop): the previous approach ran
// `xdotool search --class` then spawned a separate `xdotool getwindowname` per
// window with a 1s timeout, silently dropping any window whose lookup timed out.
// Under load (many IDE windows running agents, X11 over DCV) that produced a
// partial list — tabs vanished and focus-by-name failed for the same window —
// then "healed" on a later fetch. One wmctrl call returns all windows + titles
// at once, so there's no per-window timeout to drop on. wmctrl also lists only
// normal managed windows, so Cursor's auxiliary "cursor"-titled windows are
// excluded for free.
async function listIdeWindows() {
    const { display, stdout } = await wmctrlList();
    const ideSuffixes = [' - cursor', ' - visual studio code', ' - code'];
    const results = [];

    for (const line of stdout.split('\n')) {
        // Format: <0xWID> <desktop> <WM_CLASS> <host> <title...>
        // WM_CLASS for non-editor windows can contain spaces, but cursor.Cursor
        // / code.Code are single tokens, so this regex parses them cleanly and
        // any mis-parsed line simply won't match an editor class below.
        const m = line.match(/^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\S+)\s+\S+\s+(.*)$/);
        if (!m) continue;

        const [, windowId, , wmClass, title] = m;
        const editorType = WM_CLASS_TO_EDITOR[wmClass];
        if (!editorType) continue;

        // Require the " - <IDE>" suffix so folderless/welcome windows are skipped.
        if (!ideSuffixes.some(suffix => title.toLowerCase().endsWith(suffix))) continue;

        const projectName = extractProjectName(title, editorType);

        // Avoid duplicates (same project open in multiple windows)
        if (results.some(r => r.project_name === projectName && r.editor_type === editorType)) {
            continue;
        }

        results.push({
            window_id: windowId,
            project_name: projectName,
            editor_type: editorType,
            window_title: title,
        });
    }

    // Return the resolved display too, so focus commands hit the same one.
    return { display, windows: results };
}

// GET /api/overlay/ide-projects - scan open IDE windows
router.get('/ide-projects', async (req, res) => {
    try {
        const { display, windows } = await listIdeWindows();
        // display/probe are diagnostics: which X display was picked and what each
        // candidate looked like on the last full probe (see wmctrlList history).
        res.json({ projects: windows, display, probe: lastProbe });
    } catch (error) {
        // Real failure (wmctrl missing / X unreachable). Report it instead of
        // returning an empty list, so the frontend can keep its last-good tabs.
        res.status(500).json({ projects: [], error: error.message, probe: lastProbe });
    }
});

// POST /api/overlay/ide-projects/focus-by-name - focus IDE window by project name
// Must be before :id/focus to avoid route conflict
router.post('/ide-projects/focus-by-name', async (req, res) => {
    const { projectName } = req.body || {};
    if (!projectName) {
        return res.status(400).json({ success: false, error: 'projectName required' });
    }

    // Match project names flexibly. projectName can be path-style
    // ("-home-ubuntu-Projects-ken-diadosis-docs") while the IDE window's
    // extracted name is just "diadosis-docs". "-" is both a path separator and
    // part of folder names, so we can't reliably parse — instead we check if the
    // extracted window name appears at the END of the projectName.
    const projectNameLower = projectName.toLowerCase();

    try {
        const { display, windows } = await listIdeWindows();
        const env = { ...process.env, DISPLAY: display };
        for (const win of windows) {
            const extractedLower = win.project_name.toLowerCase();
            // exact match, endsWith, or dot-prefix folder (e.g. .claude → --claude)
            const dotStripped = extractedLower.startsWith('.') ? extractedLower.slice(1) : null;
            if (extractedLower === projectNameLower
                || projectNameLower.endsWith('-' + extractedLower)
                || (dotStripped && projectNameLower.endsWith('-' + dotStripped))) {
                await execAsync(`wmctrl -i -a ${win.window_id}`, { env, timeout: 2000 });
                return res.json({ success: true, windowId: win.window_id, projectName: win.project_name });
            }
        }
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: false, error: 'No matching IDE window found' });
});

// POST /api/overlay/ide-projects/:id/focus - focus IDE window
router.post('/ide-projects/:id/focus', async (req, res) => {
    const { id } = req.params;

    // id is interpolated into a shell command — only allow hex (0x…) or decimal
    // window IDs to prevent command injection.
    if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(id)) {
        return res.status(400).json({ success: false, error: 'Invalid window id' });
    }

    const env = { ...process.env, DISPLAY: await resolveDisplay() };

    try {
        await execAsync(`wmctrl -i -a ${id}`, { env, timeout: 2000 });
        res.json({ success: true, message: 'Window focused' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper: Extract project name from window title
function extractProjectName(windowTitle, editorType) {
    // Format: "<content> - <project> - <IDE>"
    const parts = windowTitle.split(' - ');

    if (parts.length >= 3) {
        const lastPart = parts[parts.length - 1].trim().toLowerCase();
        if (['cursor', 'visual studio code', 'code'].includes(lastPart)) {
            return parts[parts.length - 2].trim();
        }
    }

    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1].trim().toLowerCase();
        if (['cursor', 'visual studio code', 'code'].includes(lastPart)) {
            return parts[parts.length - 2].trim();
        }
        return parts[0].trim();
    }

    return windowTitle;
}

export default router;
