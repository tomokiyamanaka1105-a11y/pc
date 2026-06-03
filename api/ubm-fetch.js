export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { url } = await req.json();

  if (!url || !url.includes('userbenchmark.com')) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Fetch failed: ${res.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const html = await res.text();

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { error: 'Parse failed', raw: text };
    }

    return new Response(JSON.stringify(parsed), {
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
