require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests from the Vercel frontend, all Chrome extensions, and direct calls (no origin)
    if (!origin || origin === 'https://flowmail-frontend.vercel.app' || origin.startsWith('chrome-extension://')) {
      callback(null, true);
    } else {
      callback(null, true); // allow all for now; tighten later in production
    }
  },
  methods: ["GET", "POST"],
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



app.listen(process.env.PORT, () => {
  console.log("Server running on port " + process.env.PORT);
});
