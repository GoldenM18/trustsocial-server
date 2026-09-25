const { io } = require('socket.io-client');

const CONVERSATION_ID = 'a3dc7cb7-a20d-45e4-9b2c-274913422a8e';
const token = process.env.TEST_TOKEN;

if (!token) {
  console.error('connection error: TEST_TOKEN is not set');
  process.exit(1);
}

let receivedMessage = false;

const socket = io('http://localhost:3000', {
  auth: {
    token,
  },
});

const timeout = setTimeout(() => {
  console.error('connection error: timed out waiting for new_message');
  socket.disconnect();
  process.exit(1);
}, 15000);

socket.on('connect', () => {
  console.log('connection success');

  socket.emit('join_conversation', { conversationId: CONVERSATION_ID }, (response) => {
    if (response && response.status === 'error') {
      console.error('connection error: join failed');
      socket.disconnect();
      process.exit(1);
      return;
    }

    socket.emit('send_message', {
      conversationId: CONVERSATION_ID,
      content: 'WebSocket test message',
    });
  });
});

socket.on('connect_error', (error) => {
  console.error('connection error:', error.message);
  clearTimeout(timeout);
  process.exit(1);
});

socket.on('new_message', (message) => {
  receivedMessage = true;
  console.log('new_message', message);
  clearTimeout(timeout);
  socket.disconnect();
  process.exit(0);
});

socket.on('message_error', (error) => {
  console.error('message_error', error);
});

socket.on('disconnect', (reason) => {
  console.log('disconnect', reason);
  if (!receivedMessage) {
    clearTimeout(timeout);
    process.exit(1);
  }
});
