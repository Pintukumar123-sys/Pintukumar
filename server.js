import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const indexPath = join(directory, 'index.html');
const photoPath = join(directory, 'pintu.jpg');
const messagesPath = join(directory, 'messages.json');
const maxBodyBytes = 16_384;

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function getWhatsAppConfig() {
  const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    recipient: process.env.WHATSAPP_RECIPIENT,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME,
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
    apiVersion: process.env.WHATSAPP_API_VERSION
  };
  if (Object.values(config).some(value => !value)) return null;
  if (!/^v\d+\.\d+$/.test(config.apiVersion) || !/^\d+$/.test(config.phoneNumberId)) return null;
  config.recipient = config.recipient.replace(/\D/g, '');
  if (config.recipient.length < 8 || config.recipient.length > 15) return null;
  return config;
}

async function handleContact(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }
  if (!request.headers['content-type']?.includes('application/json')) {
    return sendJson(response, 415, { error: 'Expected a JSON request.' });
  }

  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    return sendJson(response, error.status || 400, { error: 'Please submit a valid message.' });
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return sendJson(response, 400, { error: 'Please submit a valid message.' });
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const message = typeof input.msg === 'string' ? input.msg.trim() : (typeof input.message === 'string' ? input.message.trim() : '');
  if (!name || name.length > 80 || !/^[^s@]+@[^s@]+.[^s@]+$/.test(email) || email.length > 254 || !message || message.length > 1000) {
    return sendJson(response, 400, { error: 'Enter a valid name, email, and message.' });
  }

  // 1. Save locally to messages.json so no message is ever lost
  try {
    let list = [];
    try {
      const data = await readFile(messagesPath, 'utf8');
      list = JSON.parse(data);
    } catch {}
    list.push({
      name,
      email,
      message,
      receivedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
    await writeFile(messagesPath, JSON.stringify(list, null, 2), 'utf8');
    console.log(`[NEW MESSAGE RECEIVED] From: ${name} (${email}) -> ${message}`);
  } catch (err) {
    console.warn('Could not save to messages.json:', err.message);
  }

  return sendJson(response, 200, { ok: true, message: 'Message sent successfully.' });
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/contact') return handleContact(request, response);
  if (request.method === 'GET' && pathname === '/pintu.jpg') {
    try {
      const photo = await readFile(photoPath);
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
      return response.end(photo);
    } catch {
      return sendJson(response, 404, { error: 'Photo not found.' });
    }
  }
  if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = await readFile(indexPath);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(html);
    } catch {
      return sendJson(response, 500, { error: 'Could not load the portfolio.' });
    }
  }
  return sendJson(response, 404, { error: 'Not found.' });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Portfolio server listening on port ${port}`));