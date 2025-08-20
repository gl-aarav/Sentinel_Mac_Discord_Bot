// Minimal Discord Interactions Endpoint + static site
// Deploy to your host (Render, Railway, Fly.io, VPS, etc).
// Make sure PUBLIC_KEY in env matches the one shown in your Discord application page.

import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import nacl from 'tweetnacl';

const app = express();
const PORT = process.env.PORT || 3000;

// Discord requires the raw body for signature verification.
app.use('/interactions', express.raw({ type: '*/*' }));

// For other routes, JSON/URL-encoded are fine.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(morgan('tiny'));
app.use(express.static('public'));

// --- Interactions Endpoint (POST) ---
app.post('/interactions', (req, res) => {
  const PUBLIC_KEY = process.env.PUBLIC_KEY;
  if (!PUBLIC_KEY) {
    return res.status(500).json({ error: 'Missing PUBLIC_KEY in environment.' });
  }

  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.body; // Buffer from express.raw

  if (!signature || !timestamp) {
    return res.status(401).send('Bad request signature headers.');
  }

  // Verify request
  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + rawBody),
    Buffer.from(signature, 'hex'),
    Buffer.from(PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    return res.status(401).send('Invalid request signature.');
  }

  // Parse body after verification
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).send('Invalid JSON.');
  }

  // Handle PING
  if (body.type === 1) {
    return res.json({ type: 1 }); // PONG
  }

  // Simple handler for a "ping" slash command (type 2)
  if (body.type === 2 && body.data?.name === 'ping') {
    return res.json({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: { content: 'Pong! 🏓 Interactions endpoint is alive.' }
    });
  }

  // Default response
  return res.json({
    type: 4,
    data: { content: 'Hello from your Interactions endpoint! Add logic in server.js.' }
  });
});

// --- Linked Roles "Verification URL" (GET) ---
// Discord will open this page in a webview for users. You can customize text or add OAuth later.
app.get('/linked-roles/verify', (req, res) => {
  res.sendFile(process.cwd() + '/public/linked-roles.html');
});

// Terms & Privacy
app.get('/terms', (req, res) => res.sendFile(process.cwd() + '/public/terms.html'));
app.get('/privacy', (req, res) => res.sendFile(process.cwd() + '/public/privacy.html'));

// Home
app.get('/', (req, res) => res.sendFile(process.cwd() + '/public/index.html'));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
