const { io } = require('socket.io-client');

if (!process.env.TEST_TOKEN) {
  console.error('connection error: TEST_TOKEN is not set');
  process.exit(1);
}

const socket = io('http://localhost:3000', {
  auth: {
    token: process.env.TEST_TOKEN,
  },
});

socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('connection error:', error.message);
});

socket.on('user_online', (payload) => {
  console.log('user_online', payload);
});

socket.on('user_offline', (payload) => {
  console.log('user_offline', payload);
});

socket.on('disconnect', (reason) => {
  console.log('disconnected', reason);
});
