const express = require('express');
const app = express();
const port = 3000;

// Define a route for the homepage
app.get('/', (req, res) => {
  res.send('<h1>Welcome to the Node.js Web Page!</h1>');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
