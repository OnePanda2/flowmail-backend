require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
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



// CREATE USER
app.post("/create-user", async (req, res) => {
  const { email } = req.body;

  const { data, error } = await supabase
    .from("users")
    .insert([{ email, isPaid: false }]);

  if (error) {
    return res.json({ error });
  }

  res.json({ success: true });
});



// VERIFY PAYMENT
app.post("/verify-payment", async (req, res) => {
  const { email, payment_id, plan } = req.body

  const { error } = await supabase
    .from("users")
    .update({
      isPaid: true,
      payment_id,
      plan,
    })
    .eq("email", email)

  console.log("VERIFY", email, error)

  res.json({ success: true })
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