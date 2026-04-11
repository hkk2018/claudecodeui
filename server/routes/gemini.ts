import { Router, type Router as RouterType } from 'express';
import { execFile } from 'child_process';

const router: RouterType = Router();

const GEMINI_CLI = '/usr/bin/gemini';

function runGemini(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(GEMINI_CLI, [], { timeout: 60000 }, (error, stdout, _stderr) => {
      if (error) {
        reject(error);
        return;
      }
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
  lastMessage?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// Truncate message to avoid exceeding prompt limits
function truncateMessage(msg: string, maxLen = 300): string {
  if (!msg || msg.length <= maxLen) return msg || '(無訊息)';
  return msg.slice(0, maxLen) + '...';
}

function buildSessionContext(sessions: Session[]): string {
  return sessions.map((s, idx) => {
    const timeDiff = Math.floor((Date.now() - new Date(s.lastActivity).getTime()) / 60000);
    const timeStr = timeDiff < 60 ? `${timeDiff}分鐘前` : `${Math.floor(timeDiff / 60)}小時前`;
    return `--- ${idx + 1}. ${s.projectName} (${s.isActive ? '進行中' : '已停止'}, ${timeStr}) ---
${truncateMessage(s.lastMessage || '')}`;
  }).join('\n\n');
}

// POST /api/gemini/analyze - Analyze active sessions and provide recommendations
router.post('/analyze', async (req, res) => {
  try {
    const { sessions } = req.body as { sessions: Session[] };

    if (!sessions || sessions.length === 0) {
      return res.json({ recommendation: '目前沒有活躍的會話需要分析。' });
    }

    const sessionContext = buildSessionContext(sessions);

    const prompt = `你是專案管理AI助手。以下是使用者正在進行的多個 Claude Code 開發會話，每個會話的最後訊息代表目前狀態。

請閱讀每個會話的內容，判斷哪些需要使用者決策或有 blocker，並推薦優先處理順序。

${sessionContext}

用繁體中文回覆，不超過200字。重點說明：哪個專案卡住了、為什麼卡、使用者需要做什麼決策。

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

    const sessionContext = buildSessionContext(sessions);

    const recentHistory = history.slice(-6).map(msg =>
      `${msg.role === 'user' ? '使用者' : '助手'}: ${msg.content}`
    ).join('\n');

    const prompt = `你是專案管理AI助手。以下是使用者正在進行的多個 Claude Code 開發會話，每個會話的最後訊息代表目前狀態。

${sessionContext}

請閱讀每個會話的實際內容來判斷優先順序，不要只看訊息數量。重點關注：哪些會話有 blocker、需要使用者決策、或等待回應。

${recentHistory ? `對話紀錄:\n${recentHistory}\n` : ''}
使用者: ${message}

用繁體中文回答，不超過300字。當提到專案名稱時用 [project:專案名稱] 格式。可用專案: ${sessions.map(s => s.projectName).join(', ')}`;

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
