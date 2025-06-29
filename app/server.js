const express = require("express");
const app = express();
const path = require("path");
const configRouter = require("./app/routes/config");

app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Mount the config router on /config
app.use("/config", configRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
