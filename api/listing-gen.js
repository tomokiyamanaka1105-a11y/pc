export const config = { runtime: 'edge' };

const PLATFORM_TIPS = {
  yahoo_auction: 'ヤフオク。入札を促すため商品の強みを前半に凝縮。タイトルは50文字以内。送料・動作確認済みを明記。',
  mercari:       'メルカリ。カジュアルな文体。値下げ交渉を前提に少し高めの価格設定が有効。「#ゲーミングPC」などハッシュタグも有効。',
  yahoo_flea:    'ヤフーフリマ。メルカリ同様カジュアル。即購入可能を強調。',
  ebay:          'eBay英語出品。スペックを英語で明記。モデル番号・状態コードを正確に記載。',
};

function buildPrompt(itemType, item, platform, prices) {
  const platformTip = PLATFORM_TIPS[platform] || '一般フリマ';

  let itemDesc = '';
  if (itemType === 'pc') {
    itemDesc = `
【商品種別】PC本体
【管理番号】${item.manageNo || '—'}
【名称・型番】${item.title || ''}
【CPU】${item.cpu || '不明'}
【GPU】${item.gpu || 'なし'}
【RAM】${item.ram || '不明'}
【SSD/HDD】${item.ssd || '不明'}
【電源】${item.psu || '不明'}
【マザーボード】${item.mb || '不明'}
【状態】${item.cond || '中古'}
【仕入れ価格（送料込）】¥${((item.cost || 0) + (item.ship || 0)).toLocaleString()}
【メモ】${item.memo || 'なし'}
`;
  } else {
    itemDesc = `
【商品種別】単品パーツ（${item.cat || 'その他'}）
【管理番号】${item.manageNo || '—'}
【パーツ名】${item.name || ''}
【状態】${item.cond || '中古'}
【仕入れ価格（送料込）】¥${((item.cost || 0) + (item.ship || 0)).toLocaleString()}
【メモ】${item.note || 'なし'}
`;
  }

  const priceSection = prices && Object.keys(prices).length
    ? `【AucFan落札相場データ（直近6か月・ヤフオク）】\n` +
      Object.values(prices)
        .filter(p => p.label && p.avg)
        .map(p => `  ${p.label}: 平均¥${p.avg.toLocaleString()} / 最安¥${p.min?.toLocaleString()} / 最高¥${p.max?.toLocaleString()} (${p.n}件)`)
        .join('\n')
    : '（相場データなし）';

  return `あなたはPC転売のプロフェッショナルです。以下の在庫情報と落札相場データを元に、出品に必要な情報を生成してください。

${itemDesc}
【出品プラットフォーム】${platform}
【プラットフォームの特性】${platformTip}

${priceSection}

以下のJSON形式で出力してください。JSONのみ出力し、前後に説明文を入れないこと。

{
  "title": "出品タイトル（プラットフォームの文字数制限内、検索されやすいキーワードを含む）",
  "description": "出品文（スペック・状態・動作確認・発送方法・注意事項を含む。改行は\\nで表現）",
  "suggestedPrice": 数値（円、送料込み想定の販売価格）,
  "priceReason": "価格設定の根拠（相場との比較、状態加味、利益見込みを2〜3文で）",
  "profitEstimate": 数値（仕入れ価格を引いた粗利見込み・円）,
  "keywords": ["SEO的に有効なキーワード1", "キーワード2", "キーワード3"]
}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { itemType, item, platform, prices } = await req.json();
  if (!item) return new Response(JSON.stringify({ error: 'item required' }), { status: 400 });

  const prompt = buildPrompt(itemType, item, platform || 'yahoo_auction', prices || {});

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();

  // APIエラーをそのまま返す
  if (data.error) {
    return new Response(JSON.stringify({ error: data.error.message || JSON.stringify(data.error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const raw = data.content?.[0]?.text || '';

  let result;
  try {
    result = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    result = { title: '', description: raw, suggestedPrice: 0, priceReason: '', profitEstimate: 0, keywords: [] };
  }

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
