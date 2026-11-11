const crypto = require("crypto");

exports.handler = async (event) => {
  const n = JSON.parse(event.body || "{}");
  const sig = crypto.createHash("sha512").update(String(n.order_id) + n.status_code + n.gross_amount + process.env.MIDTRANS_SERVER_KEY).digest("hex");
  if (sig !== n.signature_key) return { statusCode: 403, body: "bad signature" };
  const ok = n.transaction_status === "settlement" || (n.transaction_status === "capture" && n.fraud_status === "accept");
  const bad = ["cancel", "deny", "expire"].includes(n.transaction_status);
  if (ok || bad) {
    await fetch(process.env.SUPABASE_URL + "/rest/v1/bookings?id=eq." + encodeURIComponent(n.order_id) + "&status=eq.pending", {
      method: "PATCH",
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ status: ok ? "paid" : "cancelled" }),
    });
  }
  return { statusCode: 200, body: "ok" };
};
