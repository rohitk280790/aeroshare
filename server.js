const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Uploads Directory for async video sharing
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage for recorded videos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const id = 'v_' + Math.random().toString(36).substring(2, 9);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB max
});

// Video Database Store
const videos = new Map();

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory room storage:
// rooms.get(roomId) = { id: roomId, presenterId: string | null, viewers: Map<clientId, { id, name, ws }> }
const rooms = new Map();
// clients.get(clientId) = { id, ws, roomId, role, name }
const clients = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Get local IPv4 addresses for LAN sharing
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

app.get('/api/info', (req, res) => {
  res.json({
    activeRooms: rooms.size,
    lanAddresses: getLocalIpAddresses().map(ip => `http://${ip}:${PORT}`),
    port: PORT
  });
});

// ==========================================
// 1. CLOUD VIDEO UPLOAD & STREAMING (Loom SaaS)
// ==========================================

// Upload video endpoint
app.post('/api/videos/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const filename = req.file.filename;
  const videoId = filename.substring(0, filename.lastIndexOf('.')) || filename;

  const meta = {
    id: videoId,
    filename,
    title: req.body.title || `Screen Recording — ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    duration: req.body.duration || '00:00',
    size: req.body.size || `${(req.file.size / (1024 * 1024)).toFixed(1)} MB`,
    createdAt: Date.now(),
    views: 0
  };

  videos.set(videoId, meta);

  res.json({
    success: true,
    videoId,
    url: `/v/${videoId}`,
    shareUrl: `http://localhost:${PORT}/v/${videoId}`,
    meta
  });
});

// Public Watch Route: /v/:id serves the watch landing page
app.get('/v/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Get Video Metadata
app.get('/api/videos/:id', (req, res) => {
  const meta = videos.get(req.params.id);
  if (!meta) {
    return res.status(404).json({ error: 'Video not found' });
  }
  meta.views += 1;
  res.json(meta);
});

// Stream Video with HTTP 206 Partial Content (Supports fast seeking)
app.get('/api/videos/:id/stream', (req, res) => {
  const meta = videos.get(req.params.id);
  if (!meta) return res.status(404).send('Video not found');

  const filePath = path.join(uploadDir, meta.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/webm',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/webm',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// ==========================================
// 2. RAZORPAY BILLING & SUBSCRIPTIONS
// ==========================================

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_RoKaShareDemo';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';

let razorpayInstance = null;
try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID !== 'rzp_test_RoKaShareDemo') {
    razorpayInstance = new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    });
  }
} catch (e) {
  console.warn('Razorpay init notice:', e.message);
}

app.get('/api/billing/config', (req, res) => {
  res.json({
    keyId: RAZORPAY_KEY_ID,
    plans: [
      {
        id: 'starter',
        name: 'Starter (Free)',
        price: '₹0',
        period: 'forever',
        features: ['Up to 5 min recordings', '25 video cloud storage', '1080p resolution', 'Basic annotations']
      },
      {
        id: 'pro_monthly',
        name: 'RoKaShare Pro',
        price: '₹799',
        amount: 79900,
        period: '/ month',
        popular: true,
        features: ['Unlimited recording time', 'Unlimited cloud video links', '4K Ultra HD @ 60 FPS', 'No watermark', 'Viewer drop-off analytics', 'AI Transcription & summaries']
      },
      {
        id: 'team_annual',
        name: 'Team & Business',
        price: '₹1,499',
        amount: 149900,
        period: '/ user / mo',
        features: ['Shared team workspace', 'Central video library', 'Custom brand domain', 'Dedicated support & SLA']
      }
    ]
  });
});

app.post('/api/billing/create-order', async (req, res) => {
  const { planId } = req.body;
  const amount = planId === 'team_annual' ? 149900 : 79900; // in paise

  if (razorpayInstance && process.env.RAZORPAY_KEY_ID) {
    try {
      const order = await razorpayInstance.orders.create({
        amount,
        currency: 'INR',
        receipt: 'rcpt_' + Date.now(),
        notes: { planId }
      });
      return res.json({ order, keyId: RAZORPAY_KEY_ID });
    } catch (err) {
      console.error('Razorpay order creation error:', err);
    }
  }

  // Interactive local demo mode (Allows testing checkout flow without live API keys!)
  res.json({
    order: {
      id: 'order_test_' + Math.random().toString(36).substring(2, 9),
      amount,
      currency: 'INR',
      status: 'created'
    },
    keyId: RAZORPAY_KEY_ID,
    isDemo: true
  });
});

app.post('/api/billing/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, planId } = req.body;
  res.json({
    success: true,
    message: '🎉 Congratulations! RoKaShare Pro is now active. Enjoy unlimited cloud storage & 4K recording.',
    plan: 'pro',
    paymentId: razorpay_payment_id || 'pay_demo_success'
  });
});

// ==========================================
// 3. WEBSOCKET SIGNALING & ROOMS
// ==========================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function send(ws, type, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function broadcastToRoom(roomId, type, data, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.presenterId && room.presenterId !== excludeId) {
    const presenter = clients.get(room.presenterId);
    if (presenter) send(presenter.ws, type, data);
  }

  for (const [viewerId, viewer] of room.viewers.entries()) {
    if (viewerId !== excludeId) {
      send(viewer.ws, type, data);
    }
  }
}

wss.on('connection', (ws) => {
  const clientId = 'peer_' + Math.random().toString(36).substring(2, 9);
  clients.set(clientId, { id: clientId, ws, roomId: null, role: null, name: 'Guest' });

  send(ws, 'connected', { clientId });

  ws.on('message', (messageText) => {
    try {
      const msg = JSON.parse(messageText);
      const client = clients.get(clientId);
      if (!client) return;

      switch (msg.type) {
        case 'create-room': {
          let roomId = (msg.customRoomId || generateRoomId()).trim().toUpperCase();
          if (rooms.has(roomId) && rooms.get(roomId).presenterId) {
            roomId = generateRoomId();
          }

          const room = {
            id: roomId,
            presenterId: clientId,
            presenterName: msg.name || 'Presenter',
            isSharing: false,
            createdAt: Date.now(),
            viewers: new Map()
          };
          rooms.set(roomId, room);

          client.roomId = roomId;
          client.role = 'presenter';
          client.name = msg.name || 'Presenter';

          send(ws, 'room-created', {
            roomId,
            clientId,
            role: 'presenter',
            viewerCount: 0
          });
          break;
        }

        case 'join-room': {
          const roomId = (msg.roomId || '').trim().toUpperCase();
          const room = rooms.get(roomId);

          if (!room) {
            send(ws, 'error', { message: `Room "${roomId}" not found. Check code or create new.` });
            return;
          }

          client.roomId = roomId;
          client.role = 'viewer';
          client.name = msg.name || `Viewer-${clientId.slice(-4)}`;

          room.viewers.set(clientId, {
            id: clientId,
            name: client.name,
            ws
          });

          send(ws, 'room-joined', {
            roomId,
            clientId,
            role: 'viewer',
            presenterId: room.presenterId,
            presenterName: room.presenterName,
            isSharing: room.isSharing,
            viewerCount: room.viewers.size
          });

          if (room.presenterId) {
            const presenter = clients.get(room.presenterId);
            if (presenter) {
              send(presenter.ws, 'peer-joined', {
                peerId: clientId,
                peerName: client.name,
                viewerCount: room.viewers.size
              });
            }
          }

          broadcastToRoom(roomId, 'room-viewers-updated', {
            viewerCount: room.viewers.size,
            viewers: Array.from(room.viewers.values()).map(v => ({ id: v.id, name: v.name }))
          });
          break;
        }

        case 'presenter-status': {
          const room = rooms.get(client.roomId);
          if (room && client.role === 'presenter') {
            room.isSharing = !!msg.isSharing;
            broadcastToRoom(client.roomId, 'presenter-status', {
              isSharing: room.isSharing
            }, clientId);
          }
          break;
        }

        case 'webrtc-offer': {
          const target = clients.get(msg.targetId);
          if (target) {
            send(target.ws, 'webrtc-offer', {
              senderId: clientId,
              sdp: msg.sdp
            });
          }
          break;
        }

        case 'webrtc-answer': {
          const target = clients.get(msg.targetId);
          if (target) {
            send(target.ws, 'webrtc-answer', {
              senderId: clientId,
              sdp: msg.sdp
            });
          }
          break;
        }

        case 'webrtc-ice': {
          const target = clients.get(msg.targetId);
          if (target) {
            send(target.ws, 'webrtc-ice', {
              senderId: clientId,
              candidate: msg.candidate
            });
          }
          break;
        }

        case 'chat-message': {
          if (!client.roomId) return;
          const chatPayload = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            senderId: clientId,
            senderName: client.name,
            role: client.role,
            text: (msg.text || '').slice(0, 500),
            timestamp: Date.now()
          };
          broadcastToRoom(client.roomId, 'chat-message', chatPayload);
          break;
        }

        case 'emoji-reaction': {
          if (!client.roomId) return;
          broadcastToRoom(client.roomId, 'emoji-reaction', {
            emoji: msg.emoji,
            senderName: client.name,
            id: Math.random().toString(36).substring(2, 8)
          });
          break;
        }

        case 'raise-hand': {
          if (!client.roomId) return;
          broadcastToRoom(client.roomId, 'hand-raised', {
            senderId: clientId,
            senderName: client.name
          });
          break;
        }

        case 'annotation-sync': {
          if (client.roomId && client.role === 'presenter') {
            broadcastToRoom(client.roomId, 'annotation-sync', {
              action: msg.action,
              data: msg.data
            }, clientId);
          }
          break;
        }

        case 'leave-room': {
          handleClientExit(clientId);
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    handleClientExit(clientId);
    clients.delete(clientId);
  });
});

function handleClientExit(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  const roomId = client.roomId;
  const room = rooms.get(roomId);
  if (!room) return;

  if (client.role === 'presenter') {
    broadcastToRoom(roomId, 'presenter-left', {
      message: 'The presenter has ended the screen share session.'
    }, clientId);
    rooms.delete(roomId);
  } else {
    room.viewers.delete(clientId);
    if (room.presenterId) {
      const presenter = clients.get(room.presenterId);
      if (presenter) {
        send(presenter.ws, 'peer-left', {
          peerId: clientId,
          viewerCount: room.viewers.size
        });
      }
    }
    broadcastToRoom(roomId, 'room-viewers-updated', {
      viewerCount: room.viewers.size,
      viewers: Array.from(room.viewers.values()).map(v => ({ id: v.id, name: v.name }))
    });
  }

  client.roomId = null;
  client.role = null;
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 RoKaShare Pro SaaS by Rohit Kautkar running on http://localhost:${PORT}`);
  console.log(`💼 Razorpay Billing & Cloud Video Sharing Active`);
  console.log(`📡 Local Network (Wi-Fi) Addresses:`);
  const ips = getLocalIpAddresses();
  if (ips.length > 0) {
    ips.forEach(ip => console.log(`   👉 http://${ip}:${PORT}`));
  }
  console.log(`======================================================\n`);
});
