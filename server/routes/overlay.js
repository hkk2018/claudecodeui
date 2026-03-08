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

// GET /api/overlay/ide-projects - scan open IDE windows
router.get('/ide-projects', async (req, res) => {
    const builtinEditors = {
        cursor: {
            window_class: 'Cursor',
            window_title: 'Cursor'
        },
        vscode: {
            window_class: 'Code',
            window_title: 'Visual Studio Code'
        }
    };

    const results = [];
    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':1';

    for (const [editorType, editorConfig] of Object.entries(builtinEditors)) {
        const { window_class, window_title } = editorConfig;

        try {
            // Search for windows by class
            const searchCmd = window_class
                ? `xdotool search --class "${window_class}"`
                : `xdotool search --name "${window_title}"`;

            const { stdout: searchOutput } = await execAsync(searchCmd, {
                env,
                timeout: 2000
            });

            const windowIds = searchOutput.trim().split('\n').filter(id => id);
            if (!windowIds.length) continue;

            // Get window names for each ID
            for (const wid of windowIds) {
                try {
                    const { stdout: windowName } = await execAsync(
                        `xdotool getwindowname ${wid}`,
                        { env, timeout: 1000 }
                    );
                    const name = windowName.trim();
                    const nameLower = name.toLowerCase();

                    // Skip auxiliary windows (only class name)
                    if (window_class && nameLower === window_class.toLowerCase()) continue;
                    if (nameLower === editorType.toLowerCase()) continue;

                    // Check if it's an IDE window (ends with IDE name)
                    const ideSuffixes = ['cursor', 'visual studio code', 'code'];
                    const isIdeWindow = ideSuffixes.some(suffix =>
                        nameLower.endsWith(` - ${suffix}`)
                    );
                    if (!isIdeWindow) continue;

                    // Extract project name from window title
                    const projectName = extractProjectName(name, editorType);

                    // Avoid duplicates
                    const exists = results.some(r =>
                        r.project_name === projectName && r.editor_type === editorType
                    );
                    if (!exists) {
                        results.push({
                            window_id: wid,
                            project_name: projectName,
                            editor_type: editorType,
                            window_title: name
                        });
                    }
                } catch {
                    continue;
                }
            }
        } catch {
            continue;
        }
    }

    res.json({ projects: results });
});

// POST /api/overlay/ide-projects/:id/focus - focus IDE window
router.post('/ide-projects/:id/focus', async (req, res) => {
    const { id } = req.params;
    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':1';

    try {
        // Use xdotool to focus window by ID
        await execAsync(`xdotool windowactivate ${id}`, { env, timeout: 2000 });
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
