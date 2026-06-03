export const config = { runtime: 'edge' };

function extractScoresFromHtml(html) {
  const scores = {};

  // UserBenchmarkのスコアパターンを複数の正規表現で試みる
  const patterns = {
    total: [
      /"pc_score"\s*:\s*([\d.]+)/i,
      /Overall\s+Score[^>]*>([\d.]+)\s*%/i,
      /class="[^"]*score[^"]*"[^>]*>([\d.]+)\s*%/i,
      /"overallScore"\s*:\s*([\d.]+)/i,
      /userScore[^>]*>([\d.]+)/i,
    ],
    cpu: [
      /"cpu_score"\s*:\s*([\d.]+)/i,
      /CPU[^>]*Score[^>]*>([\d.]+)\s*%/i,
      /"cpuScore"\s*:\s*([\d.]+)/i,
    ],
    gpu: [
      /"gpu_score"\s*:\s*([\d.]+)/i,
      /GPU[^>]*Score[^>]*>([\d.]+)\s*%/i,
      /"gpuScore"\s*:\s*([\d.]+)/i,
    ],
    ram: [
      /"ram_score"\s*:\s*([\d.]+)/i,
      /RAM[^>]*Score[^>]*>([\d.]+)\s*%/i,
      /"ramScore"\s*:\s*([\d.]+)/i,
    ],
    ssd: [
      /"ssd_score"\s*:\s*([\d.]+)/i,
      /SSD[^>]*Score[^>]*>([\d.]+)\s*%/i,
      /"ssdScore"\s*:\s*([\d.]+)/i,
    ],
  };

  for (const [key, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      const m = html.match(regex);
      if (m) { scores[key] = parseFloat(m[1]); break; }
    }
  }

  // コンポーネント名を抽出
  const cpuNameMatch = html.match(/"cpu_name"\s*:\s*"([^"]+)"/i) || html.match(/Intel Core ([^<"]+)|AMD Ryzen ([^<"]+)/i);
  if (cpuNameMatch) scores.cpu_name = cpuNameMatch[1] || cpuNameMatch[0];

  const gpuNameMatch = html.match(/"gpu_name"\s*:\s*"([^"]+)"/i);
  if (gpuNameMatch) scores.gpu_name = gpuNameMatch[1];

  return scores;
}

async function callClaude(html) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下はUserBenchmarkのレポートページのHTMLです。
このHTMLから以下の情報をJSON形式で抽出してください。
存在しない項目はnullにしてください。

抽出項目:
- total: 総合スコア（数値、%表記なしの数字のみ）
- cpu: CPUスコア（数値）
- gpu: GPUスコア（数値）
- ram: RAMスコア（数値）
- ssd: SSDスコア（数値）
- hdd: HDDスコア（数値）
- cpu_name: CPU名称（文字列）
- gpu_name: GPU名称（文字列）
- ram_name: RAM名称（文字列）
- ssd_name: SSD名称（文字列）
- comment: このPCの総評を日本語で100文字程度で。ゲーミングPC転売目線で「出品タイトルに使えるアピールポイント」と「注意点」を簡潔に。

レスポンスはJSONのみ。説明文・コードブロック不要。

HTML（先頭30000文字）:
${html.substring(0, 30000)}`,
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '{}';
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await req.json();
  const { url, html: preHtml } = body;

  // ブラウザからHTMLが直接渡された場合はそのまま使う
  if (preHtml) {
    try {
      const regexScores = extractScoresFromHtml(preHtml);
      const claudeRaw = await callClaude(preHtml);
      let claudeData;
      try { claudeData = JSON.parse(claudeRaw.replace(/```json|```/g, '').trim()); } catch { claudeData = {}; }
      const merged = { ...claudeData };
      for (const [k, v] of Object.entries(regexScores)) { if (v != null) merged[k] = v; }
      return new Response(JSON.stringify(merged), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!url || !url.includes('userbenchmark.com')) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Fetch failed: ${res.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = await res.text();

    // まず正規表現で直接抽出を試みる
    const regexScores = extractScoresFromHtml(html);
    const hasRegexData = Object.values(regexScores).some(v => v != null);

    // Claude APIで詳細抽出＋コメント生成
    const claudeRaw = await callClaude(html);
    let claudeData;
    try {
      claudeData = JSON.parse(claudeRaw.replace(/```json|```/g, '').trim());
    } catch {
      claudeData = {};
    }

    // 正規表現で取れたデータを優先、なければClaudeのデータを使う
    const merged = { ...claudeData };
    for (const [k, v] of Object.entries(regexScores)) {
      if (v != null) merged[k] = v;
    }

    return new Response(JSON.stringify(merged), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
