let express = require('express');
let app = express();
let server = require('http').Server(app);
let io = require('socket.io')(server);
let stream = require('./ws/stream'); // Make sure this exists and exports a function
let path = require('path');

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // More robust file path
});

io.of('/stream').on('connection', stream);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
