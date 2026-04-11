import { Router, type Router as RouterType } from 'express';
import { execFile } from 'child_process';

const router: RouterType = Router();

const GEMINI_CLI = '/usr/bin/gemini';

function runGemini(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(GEMINI_CLI, [], { timeout: 30000 }, (error, stdout, _stderr) => {
      if (error) {
        reject(error);
        return;
      }
      // Strip stderr noise (import errors, cached credentials messages)
      resolve(stdout.trim());
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

interface Session {
  projectName: string;
  sessionId: string;
  lastActivity: string;
  messageCount: number;
  isActive: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// POST /api/gemini/analyze - Analyze active sessions and provide recommendations
router.post('/analyze', async (req, res) => {
  try {
    const { sessions } = req.body as { sessions: Session[] };

    if (!sessions || sessions.length === 0) {
      return res.json({ recommendation: '目前沒有活躍的會話需要分析。' });
    }

    const sessionContext = sessions.map((s, idx) => {
      const timeDiff = Math.floor((Date.now() - new Date(s.lastActivity).getTime()) / 60000);
      return `${idx + 1}. 專案: ${s.projectName}, 最後活動: ${timeDiff}分鐘前, 訊息: ${s.messageCount}, 狀態: ${s.isActive ? '進行中' : '已停止'}`;
    }).join('\n');

    const prompt = `你是專案管理AI助手。分析以下Claude Code開發會話，推薦優先處理的項目。

${sessionContext}

用繁體中文回覆，不超過150字。包含建議優先處理的專案和簡短理由。

當提到專案名稱時用 [project:專案名稱] 格式。可用專案: ${sessions.map(s => s.projectName).join(', ')}`;

    const recommendation = await runGemini(prompt);
    res.json({ recommendation });
  } catch (error: any) {
    console.error('Gemini analyze error:', error);
    res.status(500).json({
      error: 'Failed to analyze sessions',
      message: error.message,
    });
  }
});

// POST /api/gemini/chat - Chat with Gemini about sessions
router.post('/chat', async (req, res) => {
  try {
    const { message, history, sessions } = req.body as {
      message: string;
      history: Message[];
      sessions: Session[];
    };

    const sessionContext = sessions.map((s, idx) => {
      const timeDiff = Math.floor((Date.now() - new Date(s.lastActivity).getTime()) / 60000);
      return `${idx + 1}. 專案: ${s.projectName}, 最後活動: ${timeDiff}分鐘前, 訊息: ${s.messageCount}, 狀態: ${s.isActive ? '進行中' : '已停止'}`;
    }).join('\n');

    const recentHistory = history.slice(-6).map(msg =>
      `${msg.role === 'user' ? '使用者' : '助手'}: ${msg.content}`
    ).join('\n');

    const prompt = `你是專案管理AI助手，協助使用者管理Claude Code開發會話。

目前會話狀態:
${sessionContext}

${recentHistory ? `對話紀錄:\n${recentHistory}\n` : ''}
使用者: ${message}

用繁體中文回答，不超過200字。當提到專案名稱時用 [project:專案名稱] 格式。可用專案: ${sessions.map(s => s.projectName).join(', ')}`;

    const response = await runGemini(prompt);
    res.json({ response });
  } catch (error: any) {
    console.error('Gemini chat error:', error);
    res.status(500).json({
      error: 'Failed to chat with Gemini',
      message: error.message,
    });
  }
});

export default router;
