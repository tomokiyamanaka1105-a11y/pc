export const config = { runtime: 'edge' };

const KNOWLEDGE_BASE = `
# PC転売ナレッジベース（2026年6月版）

## 仕入れ基準
- グラボなしベース機を安く仕入れ、GTX 1660 Sを差して完成品として売る
- メモリは16GB必須。8GBなら増設してから出品（約2,000〜3,000円）
- OS再インストール後、ベンチ実測値をタイトル1行目に記載
- ブランドはGALLERIA・G-Tune・iiyama LEVEL∞のミドルタワー型に限定
- スリムタワー・省スペース型は電源容量不足リスクあり。原則スキップ

## ターゲット価格帯
- ベース機仕入れ上限：〜15,000円（送料込）
- GTX 1660 S仕入れ上限：〜9,000円（送料込）
- 総原価上限：25,800円（送料込）
- 目標売値：38,000〜43,000円
- 目標純利：8,000〜15,000円/台

## 主要CPU世代ガイド
- i5-8400/8500/8600: 6コア、TDP65W、安定した実績あり
- i5-9400F/9400: 6コア、内蔵GPU無し(9400F)、コスパ良好
- i5-10400F/10400: 6コア12スレッド、現行世代で人気
- i7-8700/9700: 8コア、高値がつきやすい
- Ryzen 5 3600/5600: AMDも可、ただしマザーボード確認必須

## GTX 1660 Superについて
- VRAM 6GB GDDR6、TDP125W、補助電源1×8pin
- フルHDゲーミングに最適、450W以上の電源推奨
- 中古相場：6,000〜9,000円

## 注意すべきリスク
- BIOSパスワードロック、電源ユニット劣化、CPUソケット曲がりピン
- Windows認証切れ（COAシール確認）、スリム筐体の電源容量不足

## Claudeとの過去の知見
- FF14ベンチ/MotionMark/UserBenchmarkを標準計測ツールとして採用
- ベンチスコアは出品タイトルに必ず入れることで落札率アップ
- 転売利益の目安：1台あたり1〜2万円、月3〜5台を目標
`;

async function searchWeb(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });
    const data = await res.json();
    const results = data.results?.map(r => `【${r.title}】${r.content}`).join('\n') || '';
    return data.answer ? `要約: ${data.answer}\n\n${results}` : results;
  } catch { return ''; }
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || 'エラー';
}

async function callGPT(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'エラー';
}

async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 800 },
      }),
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'エラー';
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { question, history } = await req.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        send({ phase: 'search', message: '🔍 最新情報を検索中...' });
        const webContext = await searchWeb(question);

        const basePrompt = `
あなたはPC転売の専門家AIです。
以下のナレッジベースと検索結果を参考に質問に答えてください。

【ナレッジベース】
${KNOWLEDGE_BASE}

${webContext ? `【最新Web検索結果】\n${webContext}\n` : ''}
【過去の会話履歴】
${(history || []).slice(-6).map(h => `${h.role === 'user' ? 'ユーザー' : 'AI'}: ${h.content}`).join('\n')}

【質問】
${question}

200〜300文字程度で具体的に回答してください。
`;

        send({ phase: 'thinking', message: '🤖 3つのAIが考え中...' });
        const [claudeAns, gptAns, geminiAns] = await Promise.all([
          callClaude(basePrompt),
          callGPT(basePrompt),
          callGemini(basePrompt),
        ]);

        send({ phase: 'answers', claude: claudeAns, gpt: gptAns, gemini: geminiAns });

        send({ phase: 'debate', message: '⚔️ AIディベート中...' });

        const debatePrompt = (myName, myAnswer, other1Name, other1Answer, other2Name, other2Answer) => `
あなたは${myName}です。PC転売専門家として以下のディベートに参加してください。

【元の質問】${question}

【あなたの最初の回答】${myAnswer}

【${other1Name}の回答】${other1Answer}

【${other2Name}の回答】${other2Answer}

他の2つのAIの意見を踏まえて、あなたの立場を補強または修正してください。
他の意見で取り入れるべき点があれば認め、異なる点は理由を述べて反論してください。
150文字程度で簡潔に。
`;

        const [claudeDebate, gptDebate, geminiDebate] = await Promise.all([
          callClaude(debatePrompt('Claude', claudeAns, 'GPT-4o', gptAns, 'Gemini', geminiAns)),
          callGPT(debatePrompt('GPT-4o', gptAns, 'Claude', claudeAns, 'Gemini', geminiAns)),
          callGemini(debatePrompt('Gemini', geminiAns, 'Claude', claudeAns, 'GPT-4o', gptAns)),
        ]);

        send({ phase: 'debate_result', claude: claudeDebate, gpt: gptDebate, gemini: geminiDebate });

        send({ phase: 'judging', message: '⚖️ 結論をまとめ中...' });

        const judgePrompt = `
あなたはPC転売の審判AIです。
3つのAIのディベートを整理して、最終結論を出してください。

【元の質問】${question}

【Claude の意見】${claudeDebate}
【GPT-4o の意見】${gptDebate}
【Gemini の意見】${geminiDebate}

以下の形式で出力してください（JSON）：
{
  "consensus": "3AIが一致している点を1〜2文で",
  "keyPoints": ["重要ポイント1", "重要ポイント2", "重要ポイント3"],
  "conclusion": "最終結論を2〜3文で。具体的な行動指針を含める",
  "confidence": "高/中/低",
  "caution": "注意点があれば1文で（なければnull）"
}
JSONのみ出力。説明文不要。
`;

        const judgeRaw = await callClaude(judgePrompt);
        let verdict;
        try {
          verdict = JSON.parse(judgeRaw.replace(/```json|```/g, '').trim());
        } catch {
          verdict = { conclusion: judgeRaw, keyPoints: [], confidence: '中', caution: null };
        }

        send({ phase: 'verdict', verdict });
        send({ phase: 'done' });

      } catch (e) {
        send({ phase: 'error', message: e.message });
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
