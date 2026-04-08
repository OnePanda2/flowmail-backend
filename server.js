require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(bodyParser.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);



const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});



// CREATE USER — check-then-insert (works even without a unique constraint on email)
app.post("/create-user", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.json({ error: "email required" });

  try {
    // 1. Check if user already exists
    const { data: existing } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      // Already in DB — nothing to do
      return res.json({ success: true, existed: true });
    }

    // 2. Insert new user
    const { error: insertError } = await supabase
      .from("users")
      .insert([{ email, isPaid: false }]);

    if (insertError) {
      console.error("create-user insert error:", insertError);
      return res.json({ error: insertError });
    }

    console.log("New user created:", email);
    res.json({ success: true, existed: false });
  } catch (err) {
    console.error("create-user exception:", err);
    res.json({ error: err.message });
  }
});



// VERIFY PAYMENT — creates user if not exists, then marks as paid
app.post("/verify-payment", async (req, res) => {
  const { email, payment_id, plan } = req.body;

  if (!email) return res.json({ error: "email required" });

  try {
    // Ensure user row exists first
    const { data: existing } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!existing) {
      await supabase.from("users").insert([{ email, isPaid: false }]);
    }

    // Now update to paid
    const { error } = await supabase
      .from("users")
      .update({ isPaid: true, payment_id, plan })
      .eq("email", email);

    console.log("VERIFY PAYMENT", email, error || "OK");
    res.json({ success: !error, error: error || null });
  } catch (err) {
    console.error("verify-payment exception:", err);
    res.json({ error: err.message });
  }
})



// CHECK SUBSCRIPTION
app.get("/check-subscription", async (req, res) => {
  const email = req.query.email;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error) {
    return res.json({ isPaid: false });
  }

  res.json({
    isPaid: data.isPaid,
  });
});



app.post("/create-subscription", async (req, res) => {
  try {
    const { plan_id } = req.body;

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan_id,
      total_count: 12,
    });

    res.json(subscription);

  } catch (err) {
    console.log(err);
    res.status(500).send("Subscription error");
  }
});




// AI REPLY GENERATION — Gemini
app.post("/api/ai/generate", async (req, res) => {
  const { tone, context } = req.body;
  console.log(`[AI] Request received for tone: ${tone}`);

  if (!tone) return res.json({ success: false, error: "tone required" });

  const systemPrompt = `You are a professional business assistant. Write a short, natural email reply. No subject lines, no markdown, no quotes. Just the body text.`;
  const userPrompt = `Context: ${context || "General professional email"}\nTone: ${tone}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.8 },
        }),
      }
    );

    const data = await response.json();
    
    // LOG THE FULL DATA TO RENDER CONSOLE FOR DIAGNOSTICS
    console.log("--- DEBUG: FULL GEMINI RESPONSE ---");
    console.dir(data, { depth: null });
    console.log("-----------------------------------");

    if (!response.ok) {
      throw new Error(data.error?.message || `Google API error ${response.status}`);
    }

    // Attempt to extract text with fallback
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) {
      const reason = data.candidates?.[0]?.finishReason || "UNKNOWN";
      throw new Error(`Gemini blocked the response. Reason: ${reason}`);
    }

    console.log("[AI] Generation successful");
    res.json({ success: true, reply });
  } catch (err) {
    console.error("AI Generation Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// EMAIL TRACKING — Register a new tracked send
app.post("/track/setup", async (req, res) => {
  const { emailId, senderEmail, recipientEmail } = req.body;

  if (!emailId) return res.json({ success: false, error: "emailId required" });

  try {
    const { error } = await supabase
      .from("tracked_emails")
      .insert([{ email_id: emailId, sender_email: senderEmail, recipient_email: recipientEmail }]);

    if (error) throw error;

    res.json({
      success: true,
      pixelUrl: `https://flowmail-backend.onrender.com/track/open/${emailId}.gif`,
    });
  } catch (err) {
    console.error("Track setup error:", err.message);
    res.json({ success: false, error: err.message });
  }
});



// EMAIL TRACKING — Pixel open event (called by recipient's email client)
app.get("/track/open/:emailId", async (req, res) => {
  const emailId = req.params.emailId.replace(/\.gif$/, "");

  try {
    await supabase
      .from("tracked_emails")
      .update({ opened: true, opened_at: new Date().toISOString() })
      .eq("email_id", emailId)
      .eq("opened", false); // Only log first open
  } catch (err) {
    console.error("Track open error:", err.message);
  }

  // Always return a 1x1 transparent GIF regardless of DB outcome
  const pixel = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": pixel.length,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(pixel);
});



app.listen(process.env.PORT, () => {
  console.log("Server running on port " + process.env.PORT);
});
