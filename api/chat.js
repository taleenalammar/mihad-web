// مِهاد — دالة الذكاء الاصطناعي (تعمل على Vercel)
// تحتاج متغير البيئة ANTHROPIC_API_KEY في إعدادات المشروع على Vercel.
// المفتاح يبقى في الخادم ولا يظهر في المتصفح.

const MODEL = process.env.MIHAD_MODEL || 'claude-haiku-5-5';

const TRIP = `بيانات الرحلة (محاكاة للعرض):
- المستخدم في حي النرجس، ووجهته جامعة الملك سعود، والوقت الآن 06:58.
- الخيار A: حافلة خط 9 ثم المترو عبر المسار الأحمر من محطة التخصصي. الوصول 07:35، المدة 35 دقيقة، التكلفة 4 ر.س. المسار شبه فارغ وبلا تحويل. (الأنسب)
- الخيار B: سيارة إلى محطة التخصصي ثم المترو عبر المسار الأحمر. الوصول 07:30، المدة 30 دقيقة، التكلفة 15 ر.س. (الأسرع)
- الخيار C: أقرب محطة مترو (7 دقائق مشيًا) على المسار الأزرق ثم الأحمر. الوصول 07:43. المسار الأزرق مزدحم 95% وفيه تحويل في محطة STC. لا نوصي به.
- الخيار E: حافلة فقط. الوصول 07:58، المدة 58 دقيقة، 4 ر.س.
- الخيار D: سيارة فقط. الوصول 07:45، المدة 45 دقيقة، نحو 38 ر.س.
- مِهاد يتابع الرحلة لحظيًا، وإذا تأخرت الحافلة ينبّه المستخدم ويقترح بديلًا من موقعه (مثل طلب سيارة من أوبر أو كريم أو جيني).
- بيانات الازدحام محاكاة حاليًا، ومستقبلًا من بيانات المشغّل.`;

const PARSE_SYSTEM = `أنت محلل طلبات في تطبيق «مِهاد» لتخطيط الرحلات في الرياض.
حوّل طلب المستخدم إلى JSON فقط، دون أي نص آخر، بهذه المفاتيح:
{"destination": "الوجهة بالعربية باختصار، وإن لم تُذكر فاكتب جامعة الملك سعود",
 "arrive_before": "HH:MM بنظام 24 ساعة أو null",
 "priority": "crowd | fast | cheap | balanced",
 "recommended": "A | B | D",
 "note": "جملة عربية فصحى قصيرة (لا تتجاوز 12 كلمة) تشرح سبب التوصية",
 "understood": "ملخص قصير جدًا لما فهمته من الطلب"}
اختر recommended من الخيارات A وB وD فقط بحسب البيانات التالية. إن طلب وقت وصول لا يحققه إلا B فاختر B.
${TRIP}`;

const CHAT_SYSTEM = `أنت «مِهاد»، مساعد ذكي لتخطيط الرحلات في الرياض.
- اكتب بالعربية الفصحى، وخاطب المستخدم بصيغة المذكر.
- أجب بجملة أو جملتين فقط، بوضوح ولطف.
- اعتمد على بيانات الرحلة التالية فقط، ولا تخترع أرقامًا أو محطات غير موجودة.
- إذا سُئلت عن أمر لا علاقة له بالتنقل، فاعتذر بلطف وأعد الحديث إلى الرحلة.
${TRIP}`;

function clean(r) {
  const out = {};
  if (typeof r.destination === 'string') out.destination = r.destination.slice(0, 40);
  if (typeof r.arrive_before === 'string' && /^\d{2}:\d{2}$/.test(r.arrive_before)) out.arrive_before = r.arrive_before;
  else out.arrive_before = null;
  out.priority = ['crowd', 'fast', 'cheap', 'balanced'].includes(r.priority) ? r.priority : 'balanced';
  out.recommended = ['A', 'B', 'D'].includes(r.recommended) ? r.recommended : 'A';
  if (typeof r.note === 'string') out.note = r.note.slice(0, 120);
  if (typeof r.understood === 'string') out.understood = r.understood.slice(0, 80);
  return out;
}

function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(503).json({ error: 'missing_api_key' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { mode, text, history } = body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 500) { res.status(400).json({ error: 'bad_input' }); return; }

  const isParse = mode === 'parse';
  const messages = isParse
    ? [{ role: 'user', content: text }]
    : [...cleanHistory(history), { role: 'user', content: text }];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: isParse ? 300 : 250, system: isParse ? PARSE_SYSTEM : CHAT_SYSTEM, messages })
    });
    if (!r.ok) { res.status(502).json({ error: 'upstream', status: r.status }); return; }
    const j = await r.json();
    const out = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    if (isParse) {
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) { res.status(502).json({ error: 'parse_failed' }); return; }
      res.status(200).json({ result: clean(JSON.parse(m[0])) });
    } else {
      res.status(200).json({ reply: out.slice(0, 600) });
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
