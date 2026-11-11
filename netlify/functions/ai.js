const SYS = "Kamu MateU AI, pendamping ngobrol yang hangat dan tidak menghakimi untuk remaja dan dewasa muda di Indonesia. Pakai bahasa Indonesia santai dan singkat (maksimal 4 kalimat). Dengarkan dulu, lalu ajukan satu pertanyaan lembut. Jangan mendiagnosis dan jangan menyarankan obat atau dosis. Kamu bukan pengganti psikolog atau psikiater. Kalau ada tanda ingin menyakiti diri atau keadaan darurat, tanggapi dengan hangat, minta mereka segera menghubungi 112 atau orang terdekat, dan sarankan bantuan profesional.";
const SUM = 'Balas HANYA dengan JSON tanpa teks lain: {"ringkasan":"1-2 kalimat memakai kata kamu","saran":"Psikolog"} dengan saran salah satu dari Psikolog atau Psikiater. Pilih Psikiater hanya jika ada kebutuhan evaluasi medis atau obat. Jangan mendiagnosis.';

async function user(event) {
  const t = (event.headers.authorization || "").replace("Bearer ", "");
  if (!t) return null;
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + t } });
  return r.ok ? { token: t, u: await r.json() } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  if (!(await user(event))) return { statusCode: 401, body: "{}" };
  let b; try { b = JSON.parse(event.body); } catch (e) { return { statusCode: 400, body: "{}" }; }
  const src = (b.messages || []).slice(-12);
  if (b.mode === "summary") src.push({ role: "user", content: "Ringkas percakapan ini sesuai instruksi." });
  const msgs = [];
  src.forEach((m) => {
    const role = m.role === "assistant" ? "assistant" : "user", c = String(m.content || "").slice(0, 1500), l = msgs[msgs.length - 1];
    if (l && l.role === role) l.content += "\n" + c; else msgs.push({ role, content: c });
  });
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return { statusCode: 400, body: "{}" };
  const sum = b.mode === "summary", system = sum ? SUM : SYS, max = sum ? 300 : 400;
  let text = "";
  if (process.env.GROQ_API_KEY) {
    // model open source (Llama) lewat Groq, gratis
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.GROQ_API_KEY },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", max_tokens: max, temperature: 0.7, messages: [{ role: "system", content: system }, ...msgs] }),
    });
    const j = await r.json();
    text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  } else {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-haiku-5-5", max_tokens: max, system, messages: msgs }),
    });
    const j = await r.json();
    text = (j.content && j.content[0] && j.content[0].text) || "";
  }
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) };
};
