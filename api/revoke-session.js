// api/sessions/revoke.js - Sign out a specific session
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
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
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        success: false,
        error: 'Session ID is required' 
      });
    }

    // Verify this session belongs to the user
    const sessionCheck = await pool.query(
      'SELECT id, user_id FROM sessions WHERE id = $1',
      [sessionId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Session not found' 
      });
    }

    if (sessionCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ 
        success: false,
        error: 'You can only revoke your own sessions' 
      });
    }

    // Sign out the session
    await pool.query(
      'UPDATE sessions SET signed_out_at = NOW() WHERE id = $1',
      [sessionId]
    );

    console.log('[SESSIONS] ✅ Session revoked:', sessionId, 'by user:', userId);

    return res.status(200).json({
      success: true,
      message: 'Session signed out successfully'
    });

  } catch (error) {
    console.error('[SESSIONS] ❌ Error revoking session:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to revoke session',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
