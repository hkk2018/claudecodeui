import express from 'express';
import { spawn, exec } from 'child_process';

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

        // After delay, set always-on-top using wmctrl
        setTimeout(() => {
            exec(`wmctrl -r "localhost:${port}" -b add,above`, (err) => {
                if (err) {
                    // Try alternative title matching
                    exec(`wmctrl -r "Claude" -b add,above`, () => {});
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

    exec(`wmctrl -r "localhost:${port}" -b ${action},above`, (err) => {
        if (err) {
            exec(`wmctrl -r "Claude" -b ${action},above`, (err2) => {
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

export default router;
