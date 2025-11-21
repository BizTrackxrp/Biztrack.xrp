// api/sessions/list.js - Get all sessions for authenticated user
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized' 
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid or expired token' 
      });
    }

    const userId = decoded.userId;

    // Get current token hash to identify current session
    const currentTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Get all active sessions for this user (not signed out)
    const result = await pool.query(
      `SELECT 
        id,
        token_hash,
        device_name,
        ip_address,
        user_agent,
        created_at,
        last_active,
        signed_out_at
      FROM sessions 
      WHERE user_id = $1 
        AND signed_out_at IS NULL
      ORDER BY last_active DESC`,
      [userId]
    );

    // Format sessions for frontend
    const sessions = result.rows.map(session => ({
      id: session.id,
      deviceName: session.device_name,
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      createdAt: session.created_at,
      lastActive: session.last_active,
      isCurrent: session.token_hash === currentTokenHash
    }));

    console.log('[SESSIONS] Listed', sessions.length, 'active sessions for user:', userId);

    return res.status(200).json({
      success: true,
      sessions: sessions,
      currentTokenHash: currentTokenHash
    });

  } catch (error) {
    console.error('[SESSIONS] ❌ Error listing sessions:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to list sessions',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
