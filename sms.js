// SMS Centre — mock by default, REAL sending via Africa's Talking / Twilio / generic HTTP gateway.
// Configure in Setup tab (saved to DB) or via env vars:
//   SMS_PROVIDER=africastalking|twilio|gateway|mock
//   AT_APIKEY, AT_USERNAME, AT_SENDER  |  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM  |  SMS_GATEWAY_URL (+SMS_APIKEY)
// Uganda numbers like 0700... are auto-normalised to +256700...
const { load, save } = require('./db');

function normPhone(p) {
  if (!p) return p;
  let s = String(p).replace(/[\s\-()]/g, '');
  if (/^0\d{9}$/.test(s)) s = '+256' + s.slice(1);
  else if (/^256\d{9}$/.test(s)) s = '+' + s;
  else if (/^\d{9}$/.test(s)) s = '+256' + s;
  return s;
}

function smsConfig() {
  let db = {};
  try { db = load(); } catch {}
  const s = (db && db.smsConfig) || {};
  return {
    provider: process.env.SMS_PROVIDER || s.provider || 'mock',
    atApiKey: process.env.AT_APIKEY || s.atApiKey || '',
    atUsername: process.env.AT_USERNAME || s.atUsername || 'sandbox',
    atSender: process.env.AT_SENDER || s.atSender || '',
    twSid: process.env.TWILIO_SID || s.twSid || '',
    twToken: process.env.TWILIO_TOKEN || s.twToken || '',
    twFrom: process.env.TWILIO_FROM || s.twFrom || '',
    gatewayUrl: process.env.SMS_GATEWAY_URL || s.gatewayUrl || '',
    gatewayKey: process.env.SMS_APIKEY || s.gatewayKey || '',
  };
}

async function sendViaAT(to, message, cfg) {
  // https://developers.africastalking.com/docs/sms/sending/bulk
  const body = new URLSearchParams({ username: cfg.atUsername, to, message });
  if (cfg.atSender) body.append('from', cfg.atSender);
  const r = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: { apiKey: cfg.atApiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const t = await r.text();
  if (!r.ok) throw new Error('AT ' + r.status + ': ' + t.slice(0, 200));
  return { provider: 'africastalking', note: t.slice(0, 200) };
}

async function sendViaTwilio(to, message, cfg) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + cfg.twSid + '/Messages.json';
  const auth = Buffer.from(cfg.twSid + ':' + cfg.twToken).toString('base64');
  const body = new URLSearchParams({ To: to, From: cfg.twFrom, Body: message });
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const t = await r.text();
  if (!r.ok) throw new Error('Twilio ' + r.status + ': ' + t.slice(0, 200));
  return { provider: 'twilio', note: 'queued' };
}

async function sendViaGateway(to, message, cfg) {
  // Generic GET/POST gateway: SMS_GATEWAY_URL with placeholders {to} {msg} {key}, or POST JSON.
  let url = cfg.gatewayUrl.replace('{to}', encodeURIComponent(to)).replace('{msg}', encodeURIComponent(message)).replace('{key}', encodeURIComponent(cfg.gatewayKey));
  const r = await fetch(url, { method: 'GET' });
  const t = await r.text();
  if (!r.ok) throw new Error('Gateway ' + r.status + ': ' + t.slice(0, 200));
  return { provider: 'gateway', note: t.slice(0, 200) };
}

async function sendViaProvider(to, message) {
  const cfg = smsConfig();
  to = normPhone(to);
  if (cfg.provider === 'mock' || !cfg.provider) return { sent: true, provider: 'mock', note: 'Logged only — set real provider in Setup → SMS' };
  if (cfg.provider === 'africastalking') return { sent: true, ...(await sendViaAT(to, message, cfg)) };
  if (cfg.provider === 'twilio') return { sent: true, ...(await sendViaTwilio(to, message, cfg)) };
  if (cfg.provider === 'gateway') return { sent: true, ...(await sendViaGateway(to, message, cfg)) };
  return { sent: true, provider: 'mock', note: 'Unknown provider, logged only' };
}

async function sendSMS(to, message, sentBy) {
  const db = load();
  let result;
  try { result = await sendViaProvider(to, message); }
  catch (e) { result = { sent: false, provider: 'error', note: e.message }; }
  const entry = { id: 'sms-' + Date.now() + '-' + Math.floor(Math.random() * 999), to: normPhone(to), message, sentBy: sentBy || 'system', date: new Date().toISOString(), status: result.sent ? 'sent (' + result.provider + ')' : 'FAILED: ' + result.note };
  db.smsLog.push(entry); save(db);
  return entry;
}

module.exports = { sendSMS, smsConfig, normPhone };

