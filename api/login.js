// api/login.js - User login with session tracking
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token WITH business_type
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        businessType: user.business_type  // ← ADD THIS!
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ==========================================
    // CREATE SESSION RECORD
    // ==========================================
    try {
      const userAgent = req.headers['user-agent'] || '';
      const ipAddress = getIPAddress(req);
      const deviceName = parseDeviceName(userAgent);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Check if session already exists
      const existingSession = await pool.query(
        'SELECT id FROM sessions WHERE token_hash = $1',
        [tokenHash]
      );

      if (existingSession.rows.length > 0) {
        // Update existing session
        await pool.query(
          'UPDATE sessions SET last_active = NOW() WHERE token_hash = $1',
          [tokenHash]
        );
        console.log('[LOGIN] Updated existing session');
      } else {
        // Create new session
        await pool.query(
          `INSERT INTO sessions (
            user_id,
            token_hash,
            device_name,
            ip_address,
            user_agent,
            created_at,
            last_active
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [user.id, tokenHash, deviceName, ipAddress, userAgent]
        );
        console.log('[LOGIN] ✅ New session created for:', user.email);
      }
    } catch (sessionError) {
      // Don't fail login if session creation fails
      console.error('[LOGIN] ⚠️ Session creation failed:', sessionError);
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        companyName: user.company_name,
        businessType: user.business_type  // ← ADD THIS!
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      error: 'Login failed',
      details: error.message
    });
  }
};
