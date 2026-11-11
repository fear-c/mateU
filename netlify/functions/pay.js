async function user(event) {
  const t = (event.headers.authorization || "").replace("Bearer ", "");
  if (!t) return null;
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + t } });
  return r.ok ? { token: t, u: await r.json() } : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  const a = await user(event);
  if (!a) return { statusCode: 401, body: "{}" };
  const { booking_id } = JSON.parse(event.body || "{}");
  // harga dibaca dari database (lewat akun si pelanggan), bukan dari kiriman browser
  const q = await fetch(process.env.SUPABASE_URL + "/rest/v1/bookings?id=eq." + encodeURIComponent(booking_id) + "&select=id,price,fee,status",
    { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + a.token } });
  const [b] = await q.json();
  if (!b || b.status !== "pending") return { statusCode: 400, body: "{}" };
  const base = process.env.MIDTRANS_PROD === "1" ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
  const r = await fetch(base + "/snap/v1/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: "Basic " + Buffer.from(process.env.MIDTRANS_SERVER_KEY + ":").toString("base64") },
    body: JSON.stringify({
      transaction_details: { order_id: b.id, gross_amount: b.price + b.fee },
      item_details: [
        { id: "konsultasi", price: b.price, quantity: 1, name: "Konsultasi MateU" },
        { id: "layanan", price: b.fee, quantity: 1, name: "Biaya layanan MateU" },
      ],
      customer_details: { email: a.u.email },
    }),
  });
  const j = await r.json();
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ token: j.token || null }) };
};
