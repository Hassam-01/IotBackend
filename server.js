const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const createClient = require("@supabase/supabase-js").createClient;

const app = express();
app.use(express.json());

const supaBaseUrl = process.env.SUPABASE_URL;
const supaBaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supaBaseUrl, supaBaseKey);

// API endpoint to get data from the "test" table
app.get("/api/test", async (req, res) => {
  try {
    const { data, error } = await supabase.from("test").select("*");
    if (error) {
      return res.status(500).json({ message: "Error fetching data", error });
    }
    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ message: "An unexpected error occurred", error: err.message });
  }
});

// Start the server
app.listen(3010, () => {
  console.log("Server is running on http://localhost:3010");
});
