const { io } = require('socket.io-client');

if (!process.env.TEST_TOKEN) {
  console.error('connection error: TEST_TOKEN is not set');
  process.exit(1);
}

if (!process.env.TEST_CONVERSATION_ID) {
  console.error('connection error: TEST_CONVERSATION_ID is not set');
  process.exit(1);
}

const socket = io('http://localhost:3000', {
  auth: {
    token: process.env.TEST_TOKEN,
  },
});

process.stdin.resume();

socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('join_conversation', {
    conversationId: process.env.TEST_CONVERSATION_ID,
  });
});

socket.on('connect_error', (error) => {
  console.error('connection error:', error.message);
});

socket.on('user_typing', (payload) => {
  console.log('user_typing', payload);
});

socket.on('user_stopped_typing', (payload) => {
  console.log('user_stopped_typing', payload);
});

socket.on('disconnect', (reason) => {
  console.log('disconnected', reason);
});
