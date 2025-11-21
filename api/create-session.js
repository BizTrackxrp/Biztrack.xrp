// api/sessions/create.js - Create new session record on login/register
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ==========================================
// DEVICE NAME PARSER (from user-agent)
// ==========================================
function parseDeviceName(userAgent) {
  if (!userAgent) return 'Unknown Device';
  
  // Operating System
  let os = 'Unknown OS';
  if (/Windows NT 10/i.test(userAgent)) os = 'Windows 10/11';
  else if (/Windows NT 6.3/i.test(userAgent)) os = 'Windows 8.1';
  else if (/Windows NT 6.2/i.test(userAgent)) os = 'Windows 8';
  else if (/Windows NT 6.1/i.test(userAgent)) os = 'Windows 7';
  else if (/Windows/i.test(userAgent)) os = 'Windows';
  else if (/Mac OS X/i.test(userAgent)) os = 'macOS';
  else if (/iPhone/i.test(userAgent)) os = 'iPhone';
  else if (/iPad/i.test(userAgent)) os = 'iPad';
  else if (/Android/i.test(userAgent)) os = 'Android';
  else if (/Linux/i.test(userAgent)) os = 'Linux';
  
  // Browser
  let browser = 'Unknown Browser';
  if (/Edg\//i.test(userAgent)) browser = 'Edge';
  else if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) browser = 'Chrome';
  else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari';
  else if (/Firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/MSIE|Trident/i.test(userAgent)) browser = 'Internet Explorer';
  
  return `${os} - ${browser}`;
}

// ==========================================
// GET IP ADDRESS (handles proxies)
// ==========================================
function getIPAddress(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'Unknown'
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        success: false,
        error: 'Token is required' 
      });
    }

    // Verify token and extract user ID
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token' 
      });
    }

    const userId = decoded.userId;

    // Get request metadata
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = getIPAddress(req);
    const deviceName = parseDeviceName(userAgent);
    
    // Create token hash (for identifying this specific session)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Check if session already exists with this token
    const existingSession = await pool.query(
      'SELECT id FROM sessions WHERE token_hash = $1',
      [tokenHash]
    );

    if (existingSession.rows.length > 0) {
      // Session already exists, just update last_active
      await pool.query(
        'UPDATE sessions SET last_active = NOW() WHERE token_hash = $1',
        [tokenHash]
      );

      console.log('[SESSIONS] Updated existing session:', existingSession.rows[0].id);

      return res.status(200).json({
        success: true,
        message: 'Session updated',
        sessionId: existingSession.rows[0].id
      });
    }

    // Create new session
    const result = await pool.query(
      `INSERT INTO sessions (
        user_id,
        token_hash,
        device_name,
        ip_address,
        user_agent,
        created_at,
        last_active
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, device_name, ip_address, created_at`,
      [userId, tokenHash, deviceName, ipAddress, userAgent]
    );

    const session = result.rows[0];

    console.log('[SESSIONS] ✅ New session created:', {
      sessionId: session.id,
      userId: userId,
      device: session.device_name,
      ip: session.ip_address
    });

    return res.status(201).json({
      success: true,
      message: 'Session created',
      session: {
        id: session.id,
        deviceName: session.device_name,
        ipAddress: session.ip_address,
        createdAt: session.created_at
      }
    });

  } catch (error) {
    console.error('[SESSIONS] ❌ Error creating session:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to create session',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
