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
  console.log('connection success');

  socket.emit(
    'join_conversation',
    { conversationId: process.env.TEST_CONVERSATION_ID },
    (response) => {
      if (response && response.status === 'error') {
        console.error('connection error: join failed');
        return;
      }

      socket.emit('mark_as_read', {
        conversationId: process.env.TEST_CONVERSATION_ID,
      });
    },
  );
});

socket.on('connect_error', (error) => {
  console.error('connection error:', error.message);
});

socket.on('messages_read', (payload) => {
  console.log('messages_read', payload);
});

socket.on('disconnect', (reason) => {
  console.log('disconnected', reason);
});
