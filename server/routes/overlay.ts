import express from 'express';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

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
        setTimeout(() => {
            const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1' };
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
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':1' };

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
async function listIdeWindows(env) {
    const { stdout } = await execAsync('wmctrl -lx', { env, timeout: 3000 });
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

    return results;
}

// GET /api/overlay/ide-projects - scan open IDE windows
router.get('/ide-projects', async (req, res) => {
    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':1';

    try {
        const projects = await listIdeWindows(env);
        res.json({ projects });
    } catch (error) {
        // Real failure (wmctrl missing / X unreachable). Report it instead of
        // returning an empty list, so the frontend can keep its last-good tabs.
        res.status(500).json({ projects: [], error: error.message });
    }
});

// POST /api/overlay/ide-projects/focus-by-name - focus IDE window by project name
// Must be before :id/focus to avoid route conflict
router.post('/ide-projects/focus-by-name', async (req, res) => {
    const { projectName } = req.body || {};
    if (!projectName) {
        return res.status(400).json({ success: false, error: 'projectName required' });
    }

    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':1';

    // Match project names flexibly. projectName can be path-style
    // ("-home-ubuntu-Projects-ken-diadosis-docs") while the IDE window's
    // extracted name is just "diadosis-docs". "-" is both a path separator and
    // part of folder names, so we can't reliably parse — instead we check if the
    // extracted window name appears at the END of the projectName.
    const projectNameLower = projectName.toLowerCase();

    try {
        const windows = await listIdeWindows(env);
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

    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':1';

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
