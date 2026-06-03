## 環境変数設定

Vercelダッシュボード → Settings → Environment Variables に以下を追加：

| 変数名 | 説明 | 取得先 |
|--------|------|--------|
| ANTHROPIC_API_KEY | Claude API | https://console.anthropic.com |
| OPENAI_API_KEY | GPT-4o API | https://platform.openai.com |
| GEMINI_API_KEY | Gemini API | https://aistudio.google.com |
| TAVILY_API_KEY | Web検索API（無料枠あり） | https://tavily.com |

ローカル開発時は `.env.local` に記載：
```
ANTHROPIC_API_KEY=sk-ant-xxxx...
OPENAI_API_KEY=sk-xxxx...
GEMINI_API_KEY=AIza-xxxx...
TAVILY_API_KEY=tvly-xxxx...
```
