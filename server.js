const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const cors = require("cors");
const app = express();
const cron = require("node-cron");

app.use(express.json());
app.use(cors({
  origin: "*", // Allow requests from your frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allow specific HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // Enable preflight requests for all routes

const supaBaseUrl = process.env.SUPABASE_URL;
const supaBaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supaBaseUrl, supaBaseKey);

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_SECRET_SENSOR = process.env.JWT_SECRET_SENSOR || "your-secret-key-sensor";


function authenticateSensorToken(req, res, next) {
    const token = req.header('Authorization') && req.header('Authorization').split(' ')[1];  // Extract the token

    if (!token) {
        return res.status(401).json({ message: "Access Denied. No Token Provided for Sensor." });
    }

    jwt.verify(token, JWT_SECRET_SENSOR, (err, sensor) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or Expired Sensor Token." });
        }
        req.sensor = sensor; // Attach sensor details to request
        next();
    });
}


// Middleware to check if the user is authenticated
function authenticateToken(req, res, next) {
  const token = req.header('Authorization') && req.header('Authorization').split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: "Access Denied. No Token Provided." });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or Expired Token." });
    }
    req.user = user;
    next();
  });
}

// Function to simulate malfunction or system error
function simulateMalfunction(sensor) {
  return Math.random() < 0.1; // 10% chance of malfunction
}

// Encryption function (AES-256)
function encryptData(data) {
  const algorithm = 'aes-256-cbc';
  const secretKey = 'your-secret-key-123';  // Use environment variables for real systems
  const iv = crypto.randomBytes(16);  // Initialization vector (IV)

  const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

// Register Route
app.post("/api/register", async (req, res) => {
    console.log(req.body);
    const { username, email, password } = req.body;
  
    // Validate input
    if (!username || !email || !password) {
        return res.status(400).json({ message: "All fields are required." });
    }
    
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    
    try {
        // Insert user into the database and retrieve the inserted data
        const { data, error } = await supabase
        .from('users')
        .insert([{ username, email, password: hashedPassword }])
        .select('user_id, username')
        .single(); // Ensures only one record is returned
        if (error) {
            return res.status(400).json({ message: error.message });
        }
        console.log("005")
  
      res.status(201).json({
        message: "User registered successfully.",
        userID: data.user_id,
        username: data.username,
      });
    } catch (err) {
      res.status(500).json({ message: "Error registering user.", error: err.message });
    }
  });
  
// api to set all sensor pass for the user = admin the user would not provide any pass
app.post("/api/setDefault", async (req, res) => {
    const { userID } = req.body;

    if (!userID) {
        return res.status(400).json({ message: "User ID is required." });
    }

    try {
        const sensorPassword = "admin";

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(sensorPassword, 10);

        // Default sensor entries
        const sensors = [
            { sensor_type: "electricity", configuration: {}, status: "running", pressure_value: 220, user_id: userID, sensor_password: hashedPassword },
            { sensor_type: "gas", configuration: {}, status: "running", pressure_value: 45, user_id: userID, sensor_password: hashedPassword },
            { sensor_type: "water", configuration: {}, status: "running", pressure_value: 45, user_id: userID, sensor_password: hashedPassword },
        ];

        // Insert default sensors into the database
        const { data, error } = await supabase.from("sensors").insert(sensors);

        if (error) {
            return res.status(400).json({ message: error.message });
        }

        res.status(201).json({ message: "Default sensors created successfully.", sensors: data });
    } catch (err) {
        console.error("Error creating default sensors:", err);
        res.status(500).json({ message: "Internal server error." });
    }
});
// get the waterdata, gasdata, electricitydata, waterStatus, gasStatus, electricStatus from the api/displayData/:userID
// data is the sensor value and status is the sensor state
app.get("/api/displayData/:userID", async (req, res) => {
    const { userID } = req.params;
    // Fetch the sensor from the database by matching the userID
    const { data: sensors, error } = await supabase
    .from('sensors')
    .select('sensor_type, pressure_value, status')
    .eq('user_id', userID);
    if (error || !sensors) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    return res.status(200).json({ sensors });
});

// endpoint for device pass verification /api/:type
app.post("/api/login/:type", async (req, res) => {
    const { type } = req.params;
    const { password: sensor_password, userID } = req.body;
    // Validate input
    if (!sensor_password) {
        return res.status(400).json({ message: "All fields are required." });
    }
    // Fetch the sensor from the database by matching the userID
    const { data: sensor, error } = await supabase
    .from('sensors')
    .select('*')
    .eq('user_id', req.body.userID)
    .eq('sensor_type', type)
    .single();
    
    if (error || !sensor) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    // Compare hashed password
    const isMatch = await bcrypt.compare(sensor_password, sensor.sensor_password);
    if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    // Create JWT token
    const token = jwt.sign({ sensorId: sensor.sensor_id, sensorType: sensor.sensor_type }, JWT_SECRET_SENSOR, { expiresIn: '10min' });
    return res.status(200).json({ token, sensorID: sensor.sensor_id, sensorType: sensor.sensor_type });
}
);

//api for shutdown sensor, modify the status of sensor to shutdown /api/shutdown/:type
app.post("/api/shutdown/:type", authenticateSensorToken, async (req, res) => {
    const { type } = req.params;
    // Fetch the sensor from the database by matching the userID
    const { data: sensor, error } = await supabase
    .from('sensors')
    .select('*')
    .eq('user_id', req.body.userID)
    .eq('sensor_type', type)
    .single();
    
    if (error || !sensor) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    // Toggle the sensor status
    const newStatus = sensor.status === "shutdown" ? "running" : "shutdown";
    const { data: updatedSensor, error: updateError } = await supabase
    .from('sensors')
    .update({ status: newStatus })
    .eq('sensor_id', sensor.sensor_id)
    .select("*")
    .single();
    if (updateError) {
        return res.status(400).json({ message: "Error updating sensor status." });
    }
    return res.status(200).json({ message: `Sensor status updated to ${newStatus} successfully.`, sensor: updatedSensor });
});


// api for getting all sensor info /api/getinfo/:type
app.post("/api/getinfo/:type", authenticateSensorToken, async (req, res) => {
    const { type } = req.params;
    // Fetch the sensor from the database by matching the userID
    const { data: sensor, error } = await supabase
    .from('sensors')
    .select('*')
    .eq('user_id', req.body.userID)
    .eq('sensor_type', type)
    .single();
    if (error || !sensor) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    return res.status(200).json({ sensor });
});

//api for changing pass of sensor /api/changePass/:type
app.post("/api/changePassword/:type", authenticateSensorToken, async (req, res) => {
    const { type } = req.params;
    const { newPassword: sensor_password, userID } = req.body;
    // Validate input
    if (!sensor_password) {
        return res.status(400).json({ message: "All fields are required." });
    }
    // Fetch the sensor from the database by matching the userID
    const { data: sensor, error } = await supabase
    .from('sensors')
    .select('*')
    .eq('user_id', req.body.userID)
    .eq('sensor_type', type)
    .single();
    
    if (error || !sensor) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    // Compare hashed password
    const hashedPassword = await bcrypt.hash(sensor_password, 10);
    // Update the sensor password
    const { data: updatedSensor, error: updateError } = await supabase
    .from('sensors')
    .update({ sensor_password: hashedPassword })
    .eq('sensor_id', sensor.sensor_id)
    .single();
    
    if (updateError) {
        return res.status(400).json({ message: "Error updating sensor password." });
    }
    return res.status(200).json({ message: "Sensor password updated successfully." });
});

// api for chaning value of sensor /api/changeValue/:type

// Login Route
app.post("/api/login", async (req, res) => {
console.log("login")
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
}

try {
    // Fetch the user from the database
    const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();
    
    if (error || !user) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    
    // Compare hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials." });
    }
    
    // Create JWT token
    const token = jwt.sign({ userId: user.user_id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    
    return res.status(200).json({ token, userID: user.user_id, userName: user.username });
} catch (err) {
    res.status(500).json({ message: "Error logging in.", error: err.message });
  }
});

// Device sensor routes (with authentication)
app.get("/api/sensor-data/water", authenticateToken, async (req, res) => {
  const allowablePressure = 150;  // Set the allowable pressure value for water sensor (in psi)
  const waterReading = generateSensorData('water', allowablePressure);

  // Encrypt the water sensor data
  const encryptedWaterData = encryptData(waterReading);

  // Insert encrypted data into Supabase
  try {
    await supabase.from('sensor_data').insert([
      { sensor_type: 'water', data: encryptedWaterData.encryptedData, iv: encryptedWaterData.iv }
    ]);
  } catch (err) {
    return res.status(500).json({ message: "Error saving water data to Supabase", error: err.message });
  }

  res.json({
    water: { encryptedData: encryptedWaterData.encryptedData, iv: encryptedWaterData.iv }
  });
});

app.get("/api/sensor-data/electricity", authenticateToken, async (req, res) => {
  const electricityReading = generateSensorData('electricity');

  // Encrypt the electricity sensor data
  const encryptedElectricityData = encryptData(electricityReading);

  // Insert encrypted data into Supabase
  try {
    await supabase.from('sensor_data').insert([
      { sensor_type: 'electricity', data: encryptedElectricityData.encryptedData, iv: encryptedElectricityData.iv }
    ]);
  } catch (err) {
    return res.status(500).json({ message: "Error saving electricity data to Supabase", error: err.message });
  }

  res.json({
    electricity: { encryptedData: encryptedElectricityData.encryptedData, iv: encryptedElectricityData.iv }
  });
});

app.get("/api/sensor-data/gas", authenticateToken, async (req, res) => {
  const gasReading = generateSensorData('gas');

  // Encrypt the gas sensor data
  const encryptedGasData = encryptData(gasReading);

  // Insert encrypted data into Supabase
  try {
    await supabase.from('sensor_data').insert([
      { sensor_type: 'gas', data: encryptedGasData.encryptedData, iv: encryptedGasData.iv }
    ]);
  } catch (err) {
    return res.status(500).json({ message: "Error saving gas data to Supabase", error: err.message });
  }

  res.json({
    gas: { encryptedData: encryptedGasData.encryptedData, iv: encryptedGasData.iv }
  });
});


// endpoint that is hit after everyone hour to update the sensor value and the state if the sensor is malfunctioning or pressure_value is high or low
app.get("/api/updateSensorData", async (req, res) => {
  try {
    // Fetch all sensors from the database
    const { data: sensors, error: fetchError } = await supabase.from('sensors').select('*');
    if (fetchError) {
      return res.status(500).json({ message: "Error fetching sensors.", error: fetchError.message });
    }

    for (const sensor of sensors) {
      let newStatus = sensor.status;
      let newPressureValue = sensor.pressure_value;
      let newState = sensor.state;

      // Simulate malfunction or system error
      if (simulateMalfunction(sensor)) {
        newStatus = "malfunction";
        newState = "risk"; // If malfunction, set state to risk
      } else {
        // Generate random pressure value based on sensor type
        if (sensor.sensor_type === "electricity") {
          newPressureValue = Math.floor(Math.random() * (260 - 150 + 1)) + 150; // Random value between 150 and 260
        } else {
          newPressureValue = Math.floor(Math.random() * 100) + 1; // Random value between 1 and 100
        }

        // Determine status based on pressure value
        if (newPressureValue < 20) {
          newStatus = "low";
        } else if (newPressureValue > 80 && sensor.sensor_type !== "electricity") {
          newStatus = "high";
        } else {
          newStatus = "running";
        }

        // Determine state based on deviation from optimal value
        const deviation = Math.abs(newPressureValue - sensor.optimal_value) / sensor.optimal_value;
        if (deviation <= 0.1) {
          newState = "moderate";
        } else {
          newState = "risk";
        }
      }

      // Update the sensor status, pressure value, and state in the database
      const { error: updateError } = await supabase
        .from('sensors')
        .update({
          status: newStatus,
          pressure_value: newPressureValue,
          state: newState,
        })
        .eq('sensor_id', sensor.sensor_id);

      if (updateError) {
        console.error(`Error updating sensor ${sensor.sensor_id}:`, updateError.message);
      }
    }

    res.status(200).json({ message: "Sensor data updated successfully." });
  } catch (error) {
    console.error("Unexpected error:", error.message);
    res.status(500).json({ message: "An unexpected error occurred.", error: error.message });
  }
});

// function to simulate a malfunction
function simulateMalfunction(sensor) {
  // Example: Randomly determine if a malfunction occurs
  return Math.random() < 0.05; // 5% chance of malfunction
}

cron.schedule("0 * * * *", async () => {
  console.log("Running scheduled task to update the database");

  try {
    const response = await axios.get("https://backend-git-main-hassam-alis-projects-909d02f3.vercel.app/api/updateSensorData", {
      sensorId: "1234", // Example sensor ID
      newValue: 42,     // Example value to update
    });
    console.log("Database updated successfully:", response.data);
  } catch (error) {
    console.error("Failed to update database:", error.message);
  }
});


// Start the server
app.listen(3010, () => {
  console.log("Server is running on http://localhost:3010");
});
